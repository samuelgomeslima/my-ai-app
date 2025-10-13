const { app } = require('@azure/functions');

const {
  getEnvironmentApiKey,
  readStoredKeyRecord,
} = require('../shared/openai');

const DEFAULT_ALLOWED_ORIGIN =
  process.env.OPENAI_STATUS_ALLOWED_ORIGIN ||
  process.env.OPENAI_CHAT_ALLOWED_ORIGIN ||
  process.env.OPENAI_SETTINGS_ALLOWED_ORIGIN ||
  '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

app.http('status', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    let source = null;
    let configured = false;
    let message = 'OpenAI API key is missing or empty on the server.';

    const environmentKey = getEnvironmentApiKey();

    if (environmentKey) {
      configured = true;
      source = 'environment';
      message = 'OpenAI API key is configured via environment variable.';
    } else {
      try {
        const stored = await readStoredKeyRecord();

        if (stored) {
          configured = true;
          source = 'storage';
          message = 'OpenAI API key is stored securely on the server.';
        }
      } catch (error) {
        context.error('Failed to determine stored OpenAI API key.', error);
        message = 'Unable to determine whether an OpenAI API key is stored on the server.';
      }
    }

    return createResponse(200, {
      openaiConfigured: configured,
      source,
      message,
      timestamp: new Date().toISOString(),
    });
  },
});
