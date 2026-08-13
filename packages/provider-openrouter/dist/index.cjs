'use strict';

var dashuProviderOpenaiCompatible = require('@rophpad/dashu-provider-openai-compatible');

// src/index.ts
var BASE_URL = "https://openrouter.ai/api/v1";
function openRouterProvider(options) {
  return dashuProviderOpenaiCompatible.openAiCompatibleProvider({
    name: "OpenRouter",
    mode: "openrouter",
    baseUrl: BASE_URL,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
    headers: {
      "HTTP-Referer": options.referer ?? "https://dashu.dev",
      "X-Title": options.title ?? "Dashu"
    }
  });
}

exports.openRouterProvider = openRouterProvider;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map