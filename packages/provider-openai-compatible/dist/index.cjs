'use strict';

var dashuCore = require('@rophpad/dashu-core');

// src/index.ts
var RETRYABLE = /* @__PURE__ */ new Set([408, 409, 425, 500, 502, 503, 504]);
var tokenParams = /* @__PURE__ */ new Map();
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isTokenParamRejection(detail) {
  const lower = detail.toLowerCase();
  return (lower.includes("max_completion_tokens") || lower.includes("max_tokens")) && (lower.includes("unsupported") || lower.includes("not supported") || lower.includes("unrecognized") || lower.includes("unknown parameter"));
}
function boundedDetail(raw) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}
function combineSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}
function openAiCompatibleProvider(options) {
  const mode = options.mode ?? "local";
  const timeoutMs = options.timeoutMs ?? 6e4;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  async function complete(request, attempt = 0, switched = false) {
    const key = `${mode}:${options.model}`;
    const tokenParam = tokenParams.get(key) ?? "max_completion_tokens";
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
          ...options.headers
        },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages,
          [tokenParam]: request.maxOutputTokens
        }),
        signal: combineSignals(request.signal, timeoutMs)
      });
    } catch (error) {
      request.signal?.throwIfAborted();
      if (attempt === 0) {
        await sleep(500);
        return complete(request, 1, switched);
      }
      throw new dashuCore.DashuError("AI_UNAVAILABLE", `Could not reach ${options.name}.`, {
        detail: error instanceof Error ? error.message : String(error),
        cause: error
      });
    }
    if (!response.ok) {
      if (RETRYABLE.has(response.status) && attempt === 0) {
        await sleep(800);
        return complete(request, 1, switched);
      }
      const raw = await response.text().catch(() => "");
      let detail = boundedDetail(raw);
      try {
        const parsed = JSON.parse(raw);
        if (parsed.error?.message) detail = boundedDetail(parsed.error.message);
      } catch {
      }
      if (response.status === 400 && !switched && isTokenParamRejection(detail)) {
        tokenParams.set(key, tokenParam === "max_tokens" ? "max_completion_tokens" : "max_tokens");
        return complete(request, attempt, true);
      }
      const message = response.status === 401 || response.status === 403 ? `${options.name} rejected the configured credential.` : response.status === 402 ? `${options.name} reports that this account is out of credit.` : response.status === 429 ? `${options.name} is rate limiting this installation. Try again shortly.` : `${options.name} could not complete the request.`;
      throw new dashuCore.DashuError("AI_UNAVAILABLE", message, {
        detail: `${response.status} ${detail}`
      });
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new dashuCore.DashuError("AI_UNAVAILABLE", `${options.name} returned an unreadable response.`);
    }
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new dashuCore.DashuError("AI_UNAVAILABLE", `${options.name} returned an empty response.`);
    }
    if (choice?.finish_reason === "length") {
      throw new dashuCore.DashuError("AI_UNAVAILABLE", "The model response was cut off before it finished.", {
        detail: "finish_reason=length"
      });
    }
    return {
      content,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens
      }
    };
  }
  return {
    name: options.name,
    mode,
    complete: (request) => complete(request)
  };
}

exports.openAiCompatibleProvider = openAiCompatibleProvider;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map