const { app } = require('@azure/functions');

const { getEnvironmentApiKey } = require('../shared/openai');

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
  handler: async (request) => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    const environmentKey = getEnvironmentApiKey();
    const configured = Boolean(environmentKey);

    return createResponse(200, {
      openaiConfigured: configured,
      source: 'environment',
      message: configured
        ? 'OPENAI_API_KEY environment variable is configured.'
        : 'OPENAI_API_KEY environment variable is missing or empty on the server.',
      timestamp: new Date().toISOString(),
    });
  },
});
