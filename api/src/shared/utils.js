const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
};

const normaliseHeaderName = (value) => value.toLowerCase();

const getHeadersRecord = (req) => {
  const headers = req && req.headers ? req.headers : null;

  if (!headers) {
    return null;
  }

  if (typeof headers.get === 'function') {
    return new Proxy(
      {},
      {
        get: (_target, key) => {
          if (typeof key !== 'string') {
            return undefined;
          }

          return headers.get(key) ?? headers.get(key.toLowerCase()) ?? undefined;
        },
        has: (_target, key) => {
          if (typeof key !== 'string') {
            return false;
          }

          return headers.has(key) || headers.has(key.toLowerCase());
        },
      },
    );
  }

  return headers;
};

const getHeader = (req, name) => {
  const headers = getHeadersRecord(req);

  if (!headers) {
    return undefined;
  }

  const target = normaliseHeaderName(name);

  if (typeof headers.get === 'function') {
    return headers.get(target) ?? undefined;
  }

  for (const key of Object.keys(headers)) {
    if (normaliseHeaderName(key) === target) {
      return headers[key];
    }
  }

  return undefined;
};

const getProvidedToken = (req) => {
  const headers = getHeadersRecord(req);

  if (!headers) {
    return undefined;
  }

  const apiKeyHeader = getHeader(req, 'x-api-key');

  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
    return apiKeyHeader;
  }

  const functionsKey = getHeader(req, 'x-functions-key');

  if (typeof functionsKey === 'string' && functionsKey.length > 0) {
    return functionsKey;
  }

  return undefined;
};

const jsonResponse = (status, body) => ({
  status,
  headers: JSON_HEADERS,
  jsonBody: body,
});

const readBufferBody = async (req) => {
  if (!req) {
    return null;
  }

  if (typeof req.arrayBuffer === 'function') {
    const buffer = await req.arrayBuffer();
    if (buffer) {
      return Buffer.from(buffer);
    }
  }

  if (req.rawBody instanceof Buffer) {
    return req.rawBody;
  }

  if (typeof req.rawBody === 'string' && req.rawBody.length > 0) {
    return Buffer.from(req.rawBody);
  }

  if (req.body instanceof Buffer) {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.length > 0) {
    return Buffer.from(req.body);
  }

  return null;
};

module.exports = {
  JSON_HEADERS,
  jsonResponse,
  getProvidedToken,
  getHeader,
  readBufferBody,
};
