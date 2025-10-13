const { app } = require('@azure/functions');

const { resolveApiKey } = require('../shared/openai');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_ALLOWED_ORIGIN =
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

app.http('chat', {
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
      context.warn('Missing OpenAI API key for chat endpoint.');
      return createResponse(500, {
        error: {
          message: 'The OpenAI API key is not configured on the server.',
        },
      });
    }

    let body;

    try {
      body = await request.json();
    } catch (error) {
      context.warn('Failed to parse request body as JSON.', error);
      return createResponse(400, {
        error: {
          message: 'Invalid JSON payload in request body.',
        },
      });
    }

    const { messages, temperature = 0.6, max_tokens, response_format } = body ?? {};

    if (!Array.isArray(messages)) {
      return createResponse(400, {
        error: {
          message: 'The request body must include a "messages" array.',
        },
      });
    }

    const payload = {
      model: 'gpt-4o-mini',
      messages,
      temperature,
    };

    if (typeof max_tokens === 'number') {
      payload.max_tokens = max_tokens;
    }

    if (response_format && typeof response_format === 'object') {
      payload.response_format = response_format;
    }

    try {
      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        context.warn('OpenAI API returned an error response.', data);
        return createResponse(response.status, data);
      }

      return createResponse(200, data);
    } catch (error) {
      context.error('Unexpected error calling OpenAI API.', error);
      return createResponse(500, {
        error: {
          message:
            'Unable to contact the AI service right now. Please try again later.',
        },
      });
    }
  },
});
