const { app } = require('@azure/functions');

const { resolveApiKey } = require('../shared/openai');

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

const DEFAULT_ALLOWED_ORIGIN =
  process.env.OPENAI_TRANSCRIPTION_PROXY_ALLOWED_ORIGIN ||
  process.env.OPENAI_TRANSCRIBE_ALLOWED_ORIGIN ||
  process.env.OPENAI_CHAT_ALLOWED_ORIGIN ||
  process.env.OPENAI_SETTINGS_ALLOWED_ORIGIN ||
  '*';

const PROXY_TOKEN =
  typeof process.env.OPENAI_TRANSCRIPTION_PROXY_TOKEN === 'string'
    ? process.env.OPENAI_TRANSCRIPTION_PROXY_TOKEN.trim()
    : typeof process.env.OPENAI_PROXY_TOKEN === 'string'
      ? process.env.OPENAI_PROXY_TOKEN.trim()
      : '';

const corsHeaders = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-OpenAI-Proxy-Token,X-Proxy-Token',
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

const readProvidedToken = (request) => {
  const authHeader = request.headers.get('authorization');

  if (typeof authHeader === 'string' && authHeader.length > 0) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  const headerToken =
    request.headers.get('x-openai-proxy-token') || request.headers.get('x-proxy-token');

  if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  try {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');
    if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
      return queryToken.trim();
    }
  } catch {
    // Ignore URL parsing errors and fall through to null return.
  }

  return null;
};

const ensureProxyReady = async (context) => {
  if (!PROXY_TOKEN) {
    context.error('Missing OPENAI_TRANSCRIPTION_PROXY_TOKEN (or OPENAI_PROXY_TOKEN) configuration.');
    return createResponse(503, {
      ok: false,
      error: {
        message: 'Server misconfiguration: missing transcription proxy token.',
      },
    });
  }

  const apiKey = await resolveApiKey(context);

  if (!apiKey) {
    context.warn('Missing OpenAI API key for transcription proxy endpoint.');
    return createResponse(503, {
      ok: false,
      error: {
        message: 'The OpenAI API key is not configured on the server.',
      },
    });
  }

  return createResponse(200, {
    ok: true,
    message: 'Transcription proxy is ready.',
  });
};

app.http('transcription-proxy', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    const configuredToken = PROXY_TOKEN;
    const providedToken = readProvidedToken(request);

    if (!configuredToken) {
      context.error('Transcription proxy called without configured token.');
      return createResponse(503, {
        ok: false,
        error: {
          message: 'Server misconfiguration: missing transcription proxy token.',
        },
      });
    }

    if (!providedToken || providedToken !== configuredToken) {
      return createResponse(401, {
        ok: false,
        error: {
          message: 'Unauthorized request.',
        },
      });
    }

    if (request.method === 'GET') {
      return ensureProxyReady(context);
    }

    if (request.method !== 'POST') {
      return createResponse(405, {
        error: {
          message: 'Method not allowed.',
        },
      });
    }

    const apiKey = await resolveApiKey(context);

    if (!apiKey) {
      context.warn('Missing OpenAI API key for transcription proxy endpoint.');
      return createResponse(500, {
        error: {
          message: 'The OpenAI API key is not configured on the server.',
        },
      });
    }

    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().startsWith('multipart/form-data')) {
      return createResponse(400, {
        error: {
          message: 'Requests must be sent as multipart/form-data.',
        },
      });
    }

    let bodyBuffer;
    try {
      const body = await request.arrayBuffer();
      if (!body || body.byteLength === 0) {
        return createResponse(400, {
          error: {
            message: 'Request body is missing or invalid.',
          },
        });
      }

      bodyBuffer = Buffer.from(body);
    } catch (error) {
      context.error('Failed to read multipart/form-data body for transcription proxy.', error);
      return createResponse(400, {
        error: {
          message: 'Request body is missing or invalid.',
        },
      });
    }

    try {
      const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': contentType,
        },
        body: bodyBuffer,
      });

      let data;
      try {
        data = await response.json();
      } catch (error) {
        context.error('Transcription proxy received a non-JSON response from OpenAI.', error);
        return createResponse(502, {
          error: {
            message: 'Unexpected response from the OpenAI transcription service.',
          },
        });
      }

      if (!response.ok) {
        context.warn('OpenAI transcription proxy request failed.', data);
        return createResponse(response.status, data);
      }

      return createResponse(200, data);
    } catch (error) {
      context.error('Unexpected error calling OpenAI transcription via proxy.', error);
      return createResponse(500, {
        error: {
          message: 'Unable to contact the transcription service right now.',
        },
      });
    }
  },
});
