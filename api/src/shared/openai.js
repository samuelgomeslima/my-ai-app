const fs = require('node:fs/promises');
const path = require('node:path');

const STORAGE_DIRECTORY = process.env.OPENAI_API_KEY_STORAGE_DIR
  ? path.resolve(process.env.OPENAI_API_KEY_STORAGE_DIR)
  : path.join(process.cwd(), 'data');

const STORAGE_FILE = process.env.OPENAI_API_KEY_STORAGE_FILE
  ? path.resolve(process.env.OPENAI_API_KEY_STORAGE_FILE)
  : path.join(STORAGE_DIRECTORY, 'openai-api-key.json');

const getEnvironmentApiKey = () => {
  if (typeof process.env.OPENAI_API_KEY !== 'string') {
    return null;
  }

  const trimmed = process.env.OPENAI_API_KEY.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readStoredKeyRecord = async () => {
  try {
    const contents = await fs.readFile(STORAGE_FILE, 'utf8');
    const data = JSON.parse(contents);

    if (!data || typeof data !== 'object') {
      return null;
    }

    const apiKey =
      'apiKey' in data && typeof data.apiKey === 'string' ? data.apiKey.trim() : '';

    if (!apiKey) {
      return null;
    }

    const updatedAt =
      'updatedAt' in data && typeof data.updatedAt === 'string'
        ? data.updatedAt
        : null;

    return { apiKey, updatedAt };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const readStoredApiKey = async () => {
  const record = await readStoredKeyRecord();
  return record ? record.apiKey : null;
};

const writeStoredApiKey = async (apiKey) => {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (!trimmed) {
    throw new Error('Cannot store an empty OpenAI API key.');
  }

  await fs.mkdir(STORAGE_DIRECTORY, { recursive: true });

  const record = {
    apiKey: trimmed,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(STORAGE_FILE, JSON.stringify(record, null, 2), 'utf8');
  return record;
};

const deleteStoredApiKey = async () => {
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

const resolveApiKey = async (context) => {
  const environmentKey = getEnvironmentApiKey();

  if (environmentKey) {
    return environmentKey;
  }

  try {
    const stored = await readStoredApiKey();

    if (stored) {
      return stored;
    }
  } catch (error) {
    if (context && typeof context.error === 'function') {
      context.error('Failed to read stored OpenAI API key.', error);
    }
  }

  return null;
};

module.exports = {
  STORAGE_DIRECTORY,
  STORAGE_FILE,
  getEnvironmentApiKey,
  readStoredApiKey,
  readStoredKeyRecord,
  writeStoredApiKey,
  deleteStoredApiKey,
  resolveApiKey,
};
