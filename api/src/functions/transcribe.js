const { app } = require('@azure/functions');

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROXY_TOKEN = process.env.OPENAI_PROXY_TOKEN;
const ALLOWED_ORIGIN =
  process.env.OPENAI_TRANSCRIBE_ALLOWED_ORIGIN ||
  process.env.OPENAI_CHAT_ALLOWED_ORIGIN ||
  process.env.OPENAI_SETTINGS_ALLOWED_ORIGIN ||
  '*';

const { jsonResponse, getProvidedToken, getHeader, readBufferBody } = require('../shared/utils');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-api-key,x-functions-key',
  'Access-Control-Max-Age': '86400',
};

const withCors = (response) => ({
  ...response,
  headers: {
    ...response.headers,
    ...corsHeaders,
  },
});

app.http('transcribe', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const method = (request.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    const configuredToken = OPENAI_PROXY_TOKEN;
    const providedToken = getProvidedToken(request);

    if (method === 'GET') {
      if (!OPENAI_API_KEY) {
        context.warn('Missing OPENAI_API_KEY environment variable.');
        return withCors(
          jsonResponse(503, {
            ok: false,
            error: {
              message: 'The OpenAI API key is not configured on the server.',
            },
          }),
        );
      }

      if (!configuredToken) {
        context.error('Missing OPENAI_PROXY_TOKEN configuration.');
        return withCors(
          jsonResponse(503, {
            ok: false,
            error: {
              message: 'Server misconfiguration: missing OpenAI proxy token.',
            },
          }),
        );
      }

      if (!providedToken || providedToken !== configuredToken) {
        return withCors(
          jsonResponse(401, {
            ok: false,
            error: {
              message: 'Unauthorized request.',
            },
          }),
        );
      }

      return withCors(
        jsonResponse(200, {
          ok: true,
          message: 'Transcription proxy is ready.',
        }),
      );
    }

    if (method !== 'POST') {
      return withCors(
        jsonResponse(405, {
          error: {
            message: 'Method not allowed.',
          },
        }),
      );
    }

    if (!OPENAI_API_KEY) {
      context.warn('Missing OPENAI_API_KEY environment variable.');
      return withCors(
        jsonResponse(500, {
          error: {
            message: 'The OpenAI API key is not configured on the server.',
          },
        }),
      );
    }

    if (!configuredToken) {
      context.error('Missing OPENAI_PROXY_TOKEN configuration.');
      return withCors(
        jsonResponse(500, {
          error: {
            message: 'Server misconfiguration: missing OpenAI proxy token.',
          },
        }),
      );
    }

    if (!providedToken || providedToken !== configuredToken) {
      return withCors(
        jsonResponse(401, {
          error: {
            message: 'Unauthorized request.',
          },
        }),
      );
    }

    const contentType = getHeader(request, 'content-type');
    if (!contentType || !contentType.toLowerCase().startsWith('multipart/form-data')) {
      return withCors(
        jsonResponse(400, {
          error: {
            message: 'Requests must be sent as multipart/form-data.',
          },
        }),
      );
    }

    try {
      const rawBody = await readBufferBody(request);

      if (!rawBody) {
        return withCors(
          jsonResponse(400, {
            error: {
              message: 'Request body is missing or invalid.',
            },
          }),
        );
      }

      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': contentType,
        },
        body: rawBody,
      });

      let data;
      try {
        data = await response.json();
      } catch (error) {
        context.error('Transcription API did not return JSON.', error);
        return withCors(
          jsonResponse(502, {
            error: {
              message: 'Unexpected response from the OpenAI transcription service.',
            },
          }),
        );
      }

      if (!response.ok) {
        context.warn('OpenAI transcription failed.', data);
        return withCors(
          jsonResponse(response.status, data),
        );
      }

      return withCors(jsonResponse(200, data));
    } catch (error) {
      context.error('Unexpected error calling OpenAI transcription.', error);
      return withCors(
        jsonResponse(500, {
          error: {
            message: 'Unable to contact the transcription service right now.',
          },
        }),
      );
    }
  },
});
