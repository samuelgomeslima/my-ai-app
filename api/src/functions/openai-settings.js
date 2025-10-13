const { app } = require('@azure/functions');

const { getEnvironmentApiKey } = require('../shared/openai');

const DEFAULT_ALLOWED_ORIGIN = process.env.OPENAI_SETTINGS_ALLOWED_ORIGIN || '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const maskKey = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  const visible = value.slice(-4);
  const hidden = '*'.repeat(value.length - visible.length);
  return `${hidden}${visible}`;
};

const createResponse = (status, body, extraHeaders = {}) => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
    ...extraHeaders,
  },
  jsonBody: body,
});

app.http('openai-settings', {
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log(`OpenAI settings handler invoked with method ${request.method}`);

    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    if (request.method !== 'GET') {
      return createResponse(
        405,
        {
          error: 'The OpenAI API key is managed via environment variables. Use a GET request to inspect the status.',
        },
        { Allow: 'GET, OPTIONS' },
      );
    }

    const environmentKey = getEnvironmentApiKey();

    if (!environmentKey) {
      return createResponse(200, {
        configured: false,
        message: 'OPENAI_API_KEY environment variable is not set. Configure it in your Azure Functions application settings.',
      });
    }

    return createResponse(200, {
      configured: true,
      preview: maskKey(environmentKey),
      message: 'OPENAI_API_KEY environment variable is configured.',
    });
  },
});
