const getEnvironmentApiKey = () => {
  if (typeof process.env.OPENAI_API_KEY !== 'string') {
    return null;
  }

  const trimmed = process.env.OPENAI_API_KEY.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveApiKey = async (context) => {
  const environmentKey = getEnvironmentApiKey();

  if (!environmentKey && context && typeof context.warn === 'function') {
    context.warn('OPENAI_API_KEY environment variable is missing or empty.');
  }

  return environmentKey;
};

module.exports = {
  getEnvironmentApiKey,
  resolveApiKey,
};
