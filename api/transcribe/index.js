import { app } from '@azure/functions';
import OpenAI, { toFile } from 'openai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.3gp': 'audio/3gpp',
    '.waptt': 'audio/ogg',
  }),
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
  const providedType = typeof file.type === 'string' && file.type.length > 0 ? file.type : null;
  const providedName = typeof file.name === 'string' ? file.name : '';
  const normalizedName = providedName.toLowerCase();

  const matchedExtension = Array.from(extensionMimeMap.keys()).find((ext) => normalizedName.endsWith(ext));
  const inferredType = providedType ?? (matchedExtension ? extensionMimeMap.get(matchedExtension) : null);
  const mimeType = inferredType ?? 'audio/webm';

  const fallbackExtension =
    matchedExtension ?? mimeFallbackExtension[mimeType] ?? '.webm';

  const safeName = providedName && providedName.trim().length > 0 ? providedName : `audio-upload${fallbackExtension}`;

  return { mimeType, fileName: safeName };
};

app.http('transcribe', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'transcribe',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: { error: 'OPENAI_API_KEY is not configured on the server.' },
      };
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (error) {
      context.error('Failed to parse multipart form data', error);
      return {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: { error: 'Unable to read uploaded audio file.' },
      };
    }

    const file = formData.get('file');

    if (!file) {
      return {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: { error: 'No audio file was provided in the "file" field.' },
      };
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const typedArray = new Uint8Array(arrayBuffer);
      const { mimeType, fileName } = determineFileMetadata(file);
      const uploadFile = await toFile(typedArray, fileName, {
        type: mimeType,
      });

      const transcription = await openai.audio.transcriptions.create({
        model: 'gpt-4o-mini-transcribe',
        file: uploadFile,
        response_format: 'verbose_json',
      });

      const fallbackText = Array.isArray(transcription.segments)
        ? transcription.segments.map((segment) => segment.text).join(' ')
        : '';

      const body = {
        text: transcription.text ?? fallbackText,
        duration: transcription.duration ?? null,
        language: transcription.language ?? null,
      };

      return {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: body,
      };
    } catch (error) {
      context.error('Transcription failed', error);

      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred while transcribing the audio.';

      return {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: { error: message },
      };
    }
  },
});
