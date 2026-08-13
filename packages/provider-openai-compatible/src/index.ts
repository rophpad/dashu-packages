import {
  DashuError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type DashuAiProvider,
} from "@rophpad/dashu-core";

export type OpenAiCompatibleOptions = {
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

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
};

const RETRYABLE = new Set([408, 409, 425, 500, 502, 503, 504]);

/**
 * Providers disagree about which parameter caps output length, and the newer
 * name is rejected outright by older servers. Remembered per model so the
 * discovery costs one request, not one per question.
 */
type TokenParam = "max_completion_tokens" | "max_tokens";
const tokenParams = new Map<string, TokenParam>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTokenParamRejection(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    (lower.includes("max_completion_tokens") || lower.includes("max_tokens")) &&
    (lower.includes("unsupported") ||
      lower.includes("not supported") ||
      lower.includes("unrecognized") ||
      lower.includes("unknown parameter"))
  );
}

/**
 * Bound whatever the provider said before it reaches an error message.
 *
 * A provider error can echo the request back, and the request contains the
 * schema prompt. Truncating is what keeps that out of a log line and out of the
 * host's error handler.
 */
function boundedDetail(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Merge the caller's cancellation with our own timeout, so a browser
 * disconnect aborts the model call instead of leaving it running.
 */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  // AbortSignal.any is Node 20+, which is also the floor for the rest of this.
  return AbortSignal.any([signal, timeout]);
}

export function openAiCompatibleProvider(options: OpenAiCompatibleOptions): DashuAiProvider {
  const mode = options.mode ?? "local";
  const timeoutMs = options.timeoutMs ?? 60_000;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function complete(
    request: AiCompletionRequest,
    attempt = 0,
    switched = false,
  ): Promise<AiCompletionResponse> {
    const key = `${mode}:${options.model}`;
    const tokenParam = tokenParams.get(key) ?? "max_completion_tokens";
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          ...options.headers,
        },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages,
          [tokenParam]: request.maxOutputTokens,
        }),
        signal: combineSignals(request.signal, timeoutMs),
      });
    } catch (error) {
      // A caller-initiated abort is not a provider failure; let it through so
      // core can report it as a cancellation.
      request.signal?.throwIfAborted();

      if (attempt === 0) {
        await sleep(500);
        return complete(request, 1, switched);
      }
      throw new DashuError("AI_UNAVAILABLE", `Could not reach ${options.name}.`, {
        detail: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }

    if (!response.ok) {
      // 429 is excluded deliberately: retrying a rate limit immediately makes
      // it worse, and the caller can decide to back off.
      if (RETRYABLE.has(response.status) && attempt === 0) {
        await sleep(800);
        return complete(request, 1, switched);
      }

      const raw = await response.text().catch(() => "");
      let detail = boundedDetail(raw);
      try {
        const parsed = JSON.parse(raw) as CompletionResponse;
        if (parsed.error?.message) detail = boundedDetail(parsed.error.message);
      } catch {
        // A bounded raw message is the most useful fallback.
      }

      if (response.status === 400 && !switched && isTokenParamRejection(detail)) {
        tokenParams.set(key, tokenParam === "max_tokens" ? "max_completion_tokens" : "max_tokens");
        return complete(request, attempt, true);
      }

      const message =
        response.status === 401 || response.status === 403
          ? `${options.name} rejected the configured credential.`
          : response.status === 402
            ? `${options.name} reports that this account is out of credit.`
            : response.status === 429
              ? `${options.name} is rate limiting this installation. Try again shortly.`
              : `${options.name} could not complete the request.`;

      throw new DashuError("AI_UNAVAILABLE", message, {
        detail: `${response.status} ${detail}`,
      });
    }

    let payload: CompletionResponse;
    try {
      payload = (await response.json()) as CompletionResponse;
    } catch {
      throw new DashuError("AI_UNAVAILABLE", `${options.name} returned an unreadable response.`);
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      throw new DashuError("AI_UNAVAILABLE", `${options.name} returned an empty response.`);
    }
    if (choice?.finish_reason === "length") {
      // A truncated plan parses as invalid JSON further down, which is a much
      // more confusing way to learn the same thing.
      throw new DashuError("AI_UNAVAILABLE", "The model response was cut off before it finished.", {
        detail: "finish_reason=length",
      });
    }

    return {
      content,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
    };
  }

  return {
    name: options.name,
    mode,
    complete: (request) => complete(request),
  };
}
