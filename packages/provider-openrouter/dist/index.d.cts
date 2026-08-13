import { DashuAiProvider } from '@rophpad/dashu-core';

type OpenRouterOptions = {
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
/**
 * OpenRouter speaks the OpenAI wire format, so this is the shared client with
 * attribution headers. Dashu Cloud is not involved in these requests: billing,
 * model choice, retention and availability are the operator's.
 */
declare function openRouterProvider(options: OpenRouterOptions): DashuAiProvider;

export { type OpenRouterOptions, openRouterProvider };
