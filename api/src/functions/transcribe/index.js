const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROXY_TOKEN = process.env.OPENAI_PROXY_TOKEN;

const {
  jsonResponse,
  getProvidedToken,
  getHeader,
  readBufferBody,
} = require("../../_shared/utils");

const ALLOWED_METHODS = ["OPTIONS", "GET", "POST"];
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
  "Access-Control-Allow-Headers": "Accept, Content-Type, x-api-key, x-functions-key",
};

module.exports = async function (context, req) {
  const method = (req?.method || "GET").toUpperCase();
  const configuredToken = OPENAI_PROXY_TOKEN;
  const providedToken = getProvidedToken(req);

  if (method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Max-Age": "86400",
      },
    };
    return;
  }

  const respond = (status, body, headers = {}) => {
    context.res = jsonResponse(status, body, {
      ...CORS_HEADERS,
      ...headers,
    });
  };

  if (method === "GET") {
    if (!OPENAI_API_KEY) {
      context.log.warn("Missing OPENAI_API_KEY environment variable.");
      respond(503, {
        ok: false,
        error: {
          message: "The OpenAI API key is not configured on the server.",
        },
      });
      return;
    }

    if (!configuredToken) {
      context.log.error("Missing OPENAI_PROXY_TOKEN configuration.");
      respond(503, {
        ok: false,
        error: {
          message: "Server misconfiguration: missing OpenAI proxy token.",
        },
      });
      return;
    }

    if (!providedToken || providedToken !== configuredToken) {
      respond(401, {
        ok: false,
        error: {
          message: "Unauthorized request.",
        },
      });
      return;
    }

    respond(200, {
      ok: true,
      message: "Transcription proxy is ready.",
    });
    return;
  }

  if (method !== "POST") {
    respond(
      405,
      {
        error: {
          message: "Method not allowed.",
        },
      },
      {
        Allow: ALLOWED_METHODS.join(", "),
      }
    );
    return;
  }

  if (!OPENAI_API_KEY) {
    context.log.warn("Missing OPENAI_API_KEY environment variable.");
    respond(500, {
      error: {
        message: "The OpenAI API key is not configured on the server.",
      },
    });
    return;
  }

  if (!configuredToken) {
    context.log.error("Missing OPENAI_PROXY_TOKEN configuration.");
    respond(500, {
      error: {
        message: "Server misconfiguration: missing OpenAI proxy token.",
      },
    });
    return;
  }

  if (!providedToken || providedToken !== configuredToken) {
    respond(401, {
      error: {
        message: "Unauthorized request.",
      },
    });
    return;
  }

  const contentType = getHeader(req, "content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    respond(400, {
      error: {
        message: "Requests must be sent as multipart/form-data.",
      },
    });
    return;
  }

  try {
    const rawBody = readBufferBody(req);

    if (!rawBody) {
      respond(400, {
        error: {
          message: "Request body is missing or invalid.",
        },
      });
      return;
    }

    const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
    if (!boundaryMatch) {
      context.log.warn("Could not determine multipart boundary for request body.");
      respond(400, {
        error: {
          message: "Missing multipart boundary on request.",
        },
      });
      return;
    }

    const boundary = boundaryMatch[1];
    const closingBoundary = `--${boundary}--`;
    const rawBodyBinary = rawBody.toString("binary");

    if (!rawBodyBinary.includes(closingBoundary)) {
      context.log.warn("Multipart body did not include a closing boundary.");
      respond(400, {
        error: {
          message: "Invalid multipart request body.",
        },
      });
      return;
    }

    const hasModelField = rawBodyBinary.includes('name="model"');
    const hasResponseFormatField = rawBodyBinary.includes('name="response_format"');

    let bodyToSend = rawBody;
    if (!hasModelField || !hasResponseFormatField) {
      const insertionIndex = rawBodyBinary.lastIndexOf(closingBoundary);
      const prefix = rawBodyBinary.slice(0, insertionIndex);
      const suffix = rawBodyBinary.slice(insertionIndex);

      let additions = "";
      if (!hasModelField) {
        additions += `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`;
      }
      if (!hasResponseFormatField) {
        additions += `\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`;
      }

      const updatedBinary = `${prefix}${additions}\r\n${suffix}`;
      bodyToSend = Buffer.from(updatedBinary, "binary");
    }

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": contentType,
      },
      body: bodyToSend,
    });

    let data;
    try {
      data = await response.json();
    } catch (error) {
      context.log.error("Transcription API did not return JSON.", error);
      respond(502, {
        error: {
          message: "Unexpected response from the OpenAI transcription service.",
        },
      });
      return;
    }

    if (!response.ok) {
      context.log.warn("OpenAI transcription failed.", data);
      respond(response.status, data);
      return;
    }

    respond(200, data);
  } catch (error) {
    context.log.error("Unexpected error calling OpenAI transcription.", error);
    respond(500, {
      error: {
        message: "Unable to contact the transcription service right now.",
      },
    });
  }
};
