const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(status, body) {
  return {
    status,
    headers: JSON_HEADERS,
    body,
  };
}

function getProvidedToken(req) {
  if (!req || typeof req !== "object" || !req.headers) return undefined;
  const headers = req.headers;
  return headers["x-api-key"] || headers["x-functions-key"];
}

function getHeader(req, name) {
  if (!req || !req.headers) return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(req.headers)) {
    if (key.toLowerCase() === target) {
      return req.headers[key];
    }
  }
  return undefined;
}

function parseJsonBody(req) {
  const body = req?.body;

  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    if (!(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      return body;
    }
  }

  if (typeof body === "string" && body.trim().length > 0) {
    return JSON.parse(body);
  }

  const rawBody = req?.rawBody;

  if (typeof rawBody === "string" && rawBody.trim().length > 0) {
    return JSON.parse(rawBody);
  }

  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString("utf8"));
  }

  if (Buffer.isBuffer(rawBody)) {
    return JSON.parse(rawBody.toString("utf8"));
  }

  if (body instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(body).toString("utf8"));
  }

  if (rawBody instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(rawBody).toString("utf8"));
  }

  if (ArrayBuffer.isView(body)) {
    return JSON.parse(Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8"));
  }

  if (ArrayBuffer.isView(rawBody)) {
    return JSON.parse(Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength).toString("utf8"));
  }

  return undefined;
}

function readBufferBody(req) {
  const body = req?.body;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof body === "string" && body.length > 0) {
    return Buffer.from(body);
  }

  const rawBody = req?.rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof ArrayBuffer) return Buffer.from(rawBody);
  if (ArrayBuffer.isView(rawBody)) {
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  if (typeof rawBody === "string" && rawBody.length > 0) {
    return Buffer.from(rawBody);
  }

  return null;
}

module.exports = {
  JSON_HEADERS,
  jsonResponse,
  getProvidedToken,
  getHeader,
  parseJsonBody,
  readBufferBody,
};
