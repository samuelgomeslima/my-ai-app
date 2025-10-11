import { app } from '@azure/functions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const getStatusPayload = () => {
  const apiKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
  const openaiConfigured = apiKey.length > 0;

  return {
    openaiConfigured,
    message: openaiConfigured
      ? 'Server check: the OPENAI_API_KEY environment variable is configured.'
      : 'Server check: the OPENAI_API_KEY environment variable is missing or empty.',
  };
};

app.http('status', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'status',
  handler: async (request) => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders,
      };
    }

    try {
      const payload = getStatusPayload();

      return {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: {
          ...payload,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to determine the server status.';

      return {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        jsonBody: {
          error: message,
        },
      };
    }
  },
});
