const { app } = require('@azure/functions');

const { resolveApiKey } = require('../shared/openai');

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

const DEFAULT_ALLOWED_ORIGIN =
  process.env.OPENAI_TRANSCRIBE_ALLOWED_ORIGIN ||
  process.env.OPENAI_CHAT_ALLOWED_ORIGIN ||
  process.env.OPENAI_SETTINGS_ALLOWED_ORIGIN ||
  '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const createResponse = (status, body) => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  },
  jsonBody: body,
});

const extensionMimeMap = new Map(
  Object.entries({
    '.aac': 'audio/aac',
    '.aif': 'audio/aiff',
    '.aiff': 'audio/aiff',
    '.amr': 'audio/amr',
    '.caf': 'audio/x-caf',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.3gp': 'audio/3gpp',
  }),
);

const sortedExtensionMimePairs = Array.from(extensionMimeMap.entries()).sort(
  (leftPair, rightPair) => rightPair[0].length - leftPair[0].length,
);

const mimeFallbackExtension = {
  'audio/3gpp': '.3gp',
  'audio/aac': '.aac',
  'audio/aiff': '.aiff',
  'audio/amr': '.amr',
  'audio/flac': '.flac',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'audio/x-caf': '.caf',
};

const determineFileMetadata = (file) => {
  const providedType =
    typeof file.type === 'string' && file.type.length > 0 && file.type !== 'application/octet-stream'
      ? file.type
      : null;
  const providedNameRaw =
    typeof file.name === 'string' && file.name.length > 0
      ? file.name
      : typeof file.filename === 'string' && file.filename.length > 0
        ? file.filename
        : '';
  const providedName = providedNameRaw;
  const normalizedName = providedName.toLowerCase();

  const matchedEntry = sortedExtensionMimePairs.find(([extension]) => normalizedName.endsWith(extension));
  const matchedExtension = matchedEntry ? matchedEntry[0] : null;
  const matchedMime = matchedEntry ? matchedEntry[1] : null;

  const inferredType = providedType ?? matchedMime;
  const mimeType = inferredType ?? 'audio/webm';

  const fallbackExtension = matchedExtension ?? mimeFallbackExtension[mimeType] ?? '.webm';

  const safeName =
    providedName && providedName.trim().length > 0 ? providedName : `audio-upload${fallbackExtension}`;

  return { mimeType, fileName: safeName };
};

const prepareOpenAiFile = async (file, fileName, mimeType) => {
  const hasFileClass = typeof File === 'function';

  if (hasFileClass && file instanceof File) {
    const currentName = typeof file.name === 'string' ? file.name : '';
    const currentType = typeof file.type === 'string' ? file.type : '';

    const needsNewName = currentName.trim().length === 0;
    const needsNewType =
      currentType.length === 0 ||
      currentType === 'application/octet-stream' ||
      (typeof mimeType === 'string' && mimeType.length > 0 && currentType !== mimeType);

    if (!needsNewName && !needsNewType) {
      return file;
    }
  }

  const buffer = await file.arrayBuffer();

  if (hasFileClass) {
    return new File([buffer], fileName, { type: mimeType });
  }

  return new Blob([buffer], { type: mimeType });
};

const buildOpenAiFormData = async (file) => {
  const { mimeType, fileName } = determineFileMetadata(file);
  const prepared = await prepareOpenAiFile(file, fileName, mimeType);
  const formData = new FormData();

  formData.append('model', 'gpt-4o-mini-transcribe');
  formData.append('response_format', 'verbose_json');

  if (typeof File === 'function' && prepared instanceof File) {
    formData.append('file', prepared);
  } else {
    formData.append('file', prepared, fileName);
  }

  return formData;
};

const toSafeNumber = (value) => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const toSafeString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readSegmentsText = (segments) => {
  if (!Array.isArray(segments)) {
    return '';
  }

  return segments
    .map((segment) => {
      if (!segment || typeof segment !== 'object') {
        return '';
      }

      const text = segment.text;
      return typeof text === 'string' ? text.trim() : '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
};

app.http('transcribe', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    const apiKey = await resolveApiKey(context);

    if (!apiKey) {
      context.warn('Missing OpenAI API key for transcription endpoint.');
      return createResponse(500, {
        error: {
          message: 'The OpenAI API key is not configured on the server.',
        },
      });
    }

    let formData;

    try {
      formData = await request.formData();
    } catch (error) {
      context.warn('Failed to parse multipart form data for transcription request.', error);
      return createResponse(400, {
        error: {
          message: 'Unable to read uploaded audio file.',
        },
      });
    }

    const file = formData.get('file');

    if (!file || typeof file.arrayBuffer !== 'function') {
      return createResponse(400, {
        error: {
          message: 'No audio file was provided in the "file" field.',
        },
      });
    }

    let openAiFormData;

    try {
      openAiFormData = await buildOpenAiFormData(file);
    } catch (error) {
      context.warn('Failed to prepare audio file for OpenAI transcription.', error);
      return createResponse(400, {
        error: {
          message: 'The uploaded audio file could not be processed.',
        },
      });
    }

    try {
      const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: openAiFormData,
      });

      const rawText = await response.text();
      let data = null;

      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch (parseError) {
          if (response.ok) {
            context.error('Failed to parse OpenAI transcription response as JSON.', parseError);
          }
        }
      }

      if (!response.ok) {
        context.warn('OpenAI API returned an error response for transcription.', data ?? rawText);
        return createResponse(response.status, data ?? {
          error: {
            message: rawText || 'OpenAI API returned an error response.',
          },
        });
      }

      if (!data || typeof data !== 'object') {
        return createResponse(502, {
          error: {
            message: 'The AI transcription service returned an empty response.',
          },
        });
      }

      const transcriptText = toSafeString(data.text) || readSegmentsText(data.segments) || '';

      return createResponse(200, {
        text: transcriptText || 'No speech was detected in the clip.',
        duration: toSafeNumber(data.duration),
        language: toSafeString(data.language),
      });
    } catch (error) {
      context.error('Unexpected error calling OpenAI transcription API.', error);
      return createResponse(500, {
        error: {
          message: 'Unable to contact the AI transcription service right now. Please try again later.',
        },
      });
    }
  },
});
