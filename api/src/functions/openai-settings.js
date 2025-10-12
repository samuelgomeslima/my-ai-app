const { app } = require('@azure/functions');
const fs = require('node:fs/promises');
const path = require('node:path');

const STORAGE_DIRECTORY = process.env.OPENAI_API_KEY_STORAGE_DIR
  ? path.resolve(process.env.OPENAI_API_KEY_STORAGE_DIR)
  : path.join(process.cwd(), 'data');

const STORAGE_FILE = process.env.OPENAI_API_KEY_STORAGE_FILE
  ? path.resolve(process.env.OPENAI_API_KEY_STORAGE_FILE)
  : path.join(STORAGE_DIRECTORY, 'openai-api-key.json');

const DEFAULT_ALLOWED_ORIGIN = process.env.OPENAI_SETTINGS_ALLOWED_ORIGIN || '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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

const readStoredKey = async () => {
  try {
    const contents = await fs.readFile(STORAGE_FILE, 'utf8');
    const data = JSON.parse(contents);

    if (!data || typeof data !== 'object') {
      return null;
    }

    const apiKey = typeof data.apiKey === 'string' ? data.apiKey : null;
    const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null;

    if (!apiKey || apiKey.trim().length === 0) {
      return null;
    }

    return { apiKey: apiKey.trim(), updatedAt };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const writeKey = async (apiKey) => {
  await fs.mkdir(STORAGE_DIRECTORY, { recursive: true });
  const record = {
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(STORAGE_FILE, JSON.stringify(record, null, 2), 'utf8');
  return record;
};

const deleteKey = async () => {
  try {
    await fs.unlink(STORAGE_FILE);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
};

const parseRequestBody = async (request) => {
  const contentType = request.headers.get('content-type') || '';

  if (!contentType) {
    // Attempt to parse JSON even without header for compatibility.
    try {
      return await request.json();
    } catch {
      return {};
    }
  }

  if (contentType.includes('application/json')) {
    return await request.json();
  }

  const text = await request.text();

  if (!text || text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const createResponse = (status, body) => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
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

    try {
      if (request.method === 'GET') {
        const stored = await readStoredKey();

        if (!stored) {
          return createResponse(200, {
            configured: false,
            message: 'No OpenAI API key is currently stored.',
          });
        }

        return createResponse(200, {
          configured: true,
          preview: maskKey(stored.apiKey),
          updatedAt: stored.updatedAt,
        });
      }

      if (request.method === 'POST') {
        const body = await parseRequestBody(request);
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

        if (!apiKey) {
          return createResponse(400, {
            error: 'Missing apiKey. Provide a non-empty OpenAI API key in the request body.',
          });
        }

        const record = await writeKey(apiKey);

        return createResponse(200, {
          success: true,
          configured: true,
          preview: maskKey(record.apiKey),
          updatedAt: record.updatedAt,
        });
      }

      if (request.method === 'DELETE') {
        const removed = await deleteKey();

        return createResponse(200, {
          success: true,
          removed,
          configured: false,
        });
      }

      return createResponse(405, {
        error: 'Method not allowed.',
      });
    } catch (error) {
      context.error('Failed to process OpenAI settings request', error);
      return createResponse(500, {
        error: 'Internal server error while processing OpenAI settings.',
      });
    }
  },
});
