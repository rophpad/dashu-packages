import { DashuAiProvider } from '@rophpad/dashu-core';

type OpenAiCompatibleOptions = {
    /** Shown in errors, so make it something an operator will recognise. */
    name: string;
    /** Reported in telemetry: "managed", "openrouter", "local". */
    mode?: string;
    /** Base URL including the version segment, e.g. http://ollama:11434/v1 */
    baseUrl: string;
    model: string;
    apiKey?: string;
    headers?: Record<string, string>;
    /** Abort a model call that hangs. */
    timeoutMs?: number;
};
declare function openAiCompatibleProvider(options: OpenAiCompatibleOptions): DashuAiProvider;

export { type OpenAiCompatibleOptions, openAiCompatibleProvider };
