import { openAiCompatibleProvider } from '@rophpad/dashu-provider-openai-compatible';

// src/index.ts
var BASE_URL = "https://openrouter.ai/api/v1";
function openRouterProvider(options) {
  return openAiCompatibleProvider({
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

export { openRouterProvider };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map