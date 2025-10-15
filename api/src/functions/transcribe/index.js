const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROXY_TOKEN = process.env.OPENAI_PROXY_TOKEN;

const { jsonResponse, getProvidedToken, getHeader, readBufferBody } = require("../_shared/utils");

module.exports = async function (context, req) {
  const method = (req?.method || "GET").toUpperCase();
  const configuredToken = OPENAI_PROXY_TOKEN;
  const providedToken = getProvidedToken(req);

  if (method === "GET") {
    if (!OPENAI_API_KEY) {
      context.log.warn("Missing OPENAI_API_KEY environment variable.");
      context.res = jsonResponse(503, {
        ok: false,
        error: {
          message: "The OpenAI API key is not configured on the server.",
        },
      });
      return;
    }

    if (!configuredToken) {
      context.log.error("Missing OPENAI_PROXY_TOKEN configuration.");
      context.res = jsonResponse(503, {
        ok: false,
        error: {
          message: "Server misconfiguration: missing OpenAI proxy token.",
        },
      });
      return;
    }

    if (!providedToken || providedToken !== configuredToken) {
      context.res = jsonResponse(401, {
        ok: false,
        error: {
          message: "Unauthorized request.",
        },
      });
      return;
    }

    context.res = jsonResponse(200, {
      ok: true,
      message: "Transcription proxy is ready.",
    });
    return;
  }

  if (method !== "POST") {
    context.res = jsonResponse(405, {
      error: {
        message: "Method not allowed.",
      },
    });
    return;
  }

  if (!OPENAI_API_KEY) {
    context.log.warn("Missing OPENAI_API_KEY environment variable.");
    context.res = jsonResponse(500, {
      error: {
        message: "The OpenAI API key is not configured on the server.",
      },
    });
    return;
  }

  if (!configuredToken) {
    context.log.error("Missing OPENAI_PROXY_TOKEN configuration.");
    context.res = jsonResponse(500, {
      error: {
        message: "Server misconfiguration: missing OpenAI proxy token.",
      },
    });
    return;
  }

  if (!providedToken || providedToken !== configuredToken) {
    context.res = jsonResponse(401, {
      error: {
        message: "Unauthorized request.",
      },
    });
    return;
  }

  const contentType = getHeader(req, "content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    context.res = jsonResponse(400, {
      error: {
        message: "Requests must be sent as multipart/form-data.",
      },
    });
    return;
  }

  try {
    const rawBody = readBufferBody(req);

    if (!rawBody) {
      context.res = jsonResponse(400, {
        error: {
          message: "Request body is missing or invalid.",
        },
      });
      return;
    }

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": contentType,
      },
      body: rawBody,
    });

    let data;
    try {
      data = await response.json();
    } catch (error) {
      context.log.error("Transcription API did not return JSON.", error);
      context.res = jsonResponse(502, {
        error: {
          message: "Unexpected response from the OpenAI transcription service.",
        },
      });
      return;
    }

    if (!response.ok) {
      context.log.warn("OpenAI transcription failed.", data);
      context.res = jsonResponse(response.status, data);
      return;
    }

    context.res = jsonResponse(200, data);
  } catch (error) {
    context.log.error("Unexpected error calling OpenAI transcription.", error);
    context.res = jsonResponse(500, {
      error: {
        message: "Unable to contact the transcription service right now.",
      },
    });
  }
};
