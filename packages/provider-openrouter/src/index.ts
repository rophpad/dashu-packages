import type { DashuAiProvider } from "@rophpad/dashu-core";
import { openAiCompatibleProvider } from "@rophpad/dashu-provider-openai-compatible";

export type OpenRouterOptions = {
  /**
   * The operator's own OpenRouter key. It stays on the backend: nothing in this
   * package returns it, and a settings endpoint must mask it.
   */
  apiKey: string;
  model: string;
  /** Sent as HTTP-Referer, which is how OpenRouter attributes traffic. */
  referer?: string;
  title?: string;
  timeoutMs?: number;
};

const BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter speaks the OpenAI wire format, so this is the shared client with
 * attribution headers. Dashu Cloud is not involved in these requests: billing,
 * model choice, retention and availability are the operator's.
 */
export function openRouterProvider(options: OpenRouterOptions): DashuAiProvider {
  return openAiCompatibleProvider({
    name: "OpenRouter",
    mode: "openrouter",
    baseUrl: BASE_URL,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
    headers: {
      "HTTP-Referer": options.referer ?? "https://dashu.dev",
      "X-Title": options.title ?? "Dashu",
    },
  });
}
