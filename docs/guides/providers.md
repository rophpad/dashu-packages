# AI providers

Dashu uses an AI provider only to produce a query plan. The provider receives a planning prompt and returns JSON containing SQL, an explanation, and a declarative display suggestion. SQL validation and execution happen later in your backend.

## Choose a provider

The database adapter and AI provider are independent. Pass any `DashuAiProvider` as `ai` to `createDashu`.

| Provider | Use it when | Request path | Credentials |
|---|---|---|---|
| `managedProvider` | You want Dashu Cloud to own model routing, provider credentials, entitlement, quotas, and rate limiting | Backend → Dashu Cloud → model provider | Dashu installation credential |
| `openRouterProvider` | You want to choose an OpenRouter model and use your own OpenRouter account | Backend → OpenRouter | Your OpenRouter API key |
| `openAiCompatibleProvider` | You run Ollama, vLLM, LocalAI, llama.cpp, an internal gateway, or another OpenAI-compatible endpoint | Backend → configured endpoint | Optional bearer token and custom headers |

Only `managedProvider` sends requests through Dashu Cloud. `openRouterProvider` calls OpenRouter directly, and `openAiCompatibleProvider` calls exactly the base URL you configure.

All three implementations are server-side code. Do not put provider credentials in browser code or public environment variables.

## What crosses the provider boundary

`planQuery` constructs the complete provider payload from:

- the current question;
- the schema after schema policy has removed denied tables and columns;
- database-dialect rules;
- approved semantic terms and notes, when supplied;
- up to six follow-up turns, each containing the earlier question and generated SQL;
- on a query repair, the failed SQL and database error detail.

Database credentials, result rows, and host session cookies are not included. SQL execution stays in the host backend.

This distinction matters for privacy reviews:

- A remote provider does see schema names and column names that remain after filtering.
- A remote provider does see the user's question, which may itself contain sensitive text.
- Follow-up history sends prior generated SQL. Disable client history if this is not acceptable.
- A repair request sends the database driver's error detail to the provider because it is used to correct SQL. That detail is not returned to the browser, but a driver message can contain table names or literal values.
- Deny rules reduce what enters the prompt, but database grants remain the security boundary. Use a dedicated read-only role and purpose-built views.

## Dashu Managed AI

Install and configure `@rophpad/dashu-provider-managed`:

```ts
import { createDashu } from "@rophpad/dashu-core";
import { managedProvider } from "@rophpad/dashu-provider-managed";

const dashu = createDashu({
  ai: managedProvider({
    cloudUrl: process.env.DASHU_CLOUD_URL!,
    credential: process.env.DASHU_INSTALLATION_CREDENTIAL!,
    // Optional capability name; managed routing chooses the vendor model.
    model: "dashu-sql",
    timeoutMs: 60_000,
  }),
  dataSources,
});
```

### `ManagedOptions`

| Option | Required | Default | Behavior |
|---|---:|---|---|
| `cloudUrl` | Yes | — | Dashu Cloud deployment root, for example `https://dashu.dev`. Trailing slashes are removed and requests go to `<cloudUrl>/api/ai/v1/chat/completions`. |
| `credential` | Yes | — | Revocable installation credential, sent as a bearer token. Keep it on the backend. |
| `model` | No | `"dashu-sql"` | A managed capability name rather than necessarily a vendor model ID. |
| `timeoutMs` | No | `60000` | Per model-call timeout in milliseconds. |

`cloudUrl` and `credential` are trimmed. If either is empty, construction throws `DashuError` with code `AI_NOT_CONFIGURED`.

The returned provider reports `name: "Dashu Managed AI"` and `mode: "managed"`. The mode appears in result metadata and observability events.

## OpenRouter

Install and configure `@rophpad/dashu-provider-openrouter`:

```ts
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

const ai = openRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: "openai/gpt-4.1-mini",
  referer: "https://admin.example.com",
  title: "Example Analytics",
  timeoutMs: 60_000,
});
```

### `OpenRouterOptions`

| Option | Required | Default | Behavior |
|---|---:|---|---|
| `apiKey` | Yes | — | Operator-owned OpenRouter key, sent as a bearer token. |
| `model` | Yes | — | OpenRouter model identifier included in every completion request. |
| `referer` | No | `"https://dashu.dev"` | Sent as `HTTP-Referer` for OpenRouter attribution. |
| `title` | No | `"Dashu"` | Sent as `X-Title`. |
| `timeoutMs` | No | `60000` | Per model-call timeout in milliseconds. |

The endpoint is fixed at `https://openrouter.ai/api/v1/chat/completions`. The returned provider reports `name: "OpenRouter"` and `mode: "openrouter"`. Dashu Cloud is not involved; billing, model choice, retention, and availability are controlled by the operator's OpenRouter setup.

## OpenAI-compatible endpoints

Use `@rophpad/dashu-provider-openai-compatible` for a local model or any service implementing OpenAI-style chat completions:

```ts
import { openAiCompatibleProvider } from "@rophpad/dashu-provider-openai-compatible";

const ai = openAiCompatibleProvider({
  name: "Internal model",
  mode: "local",
  baseUrl: "http://ollama:11434/v1",
  model: "qwen2.5-coder:7b",
  timeoutMs: 90_000,
});
```

The provider removes trailing slashes from `baseUrl` and posts to `<baseUrl>/chat/completions`.

### `OpenAiCompatibleOptions`

| Option | Required | Default | Behavior |
|---|---:|---|---|
| `name` | Yes | — | Human-readable provider name used in operator-facing error messages. |
| `baseUrl` | Yes | — | URL including any version segment, such as `http://ollama:11434/v1`. |
| `model` | Yes | — | Model value sent in the request body. |
| `mode` | No | `"local"` | Provider identifier used in result metadata and events. It also scopes token-parameter discovery by model. |
| `apiKey` | No | — | When present, adds `Authorization: Bearer <apiKey>`. |
| `headers` | No | — | Additional request headers. They are merged after content type and authorization, so same-name entries override generated headers. |
| `timeoutMs` | No | `60000` | Per model-call timeout in milliseconds. |

The request body contains `model`, `messages`, and the output-token ceiling. The implementation starts with `max_completion_tokens`. If a server returns HTTP 400 and identifies that parameter as unsupported or unknown, Dashu switches to `max_tokens`, retries immediately, and remembers the working parameter in process memory for that `mode:model` pair. This compatibility switch is separate from transport retries.

### Local examples

#### Ollama

Ollama exposes an OpenAI-compatible endpoint under `/v1`:

```ts
const ai = openAiCompatibleProvider({
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "qwen2.5-coder:7b",
});
```

When the application itself runs in a container, `127.0.0.1` is that application container. Use the reachable service name instead when Ollama is another container:

```ts
const ai = openAiCompatibleProvider({
  name: "Ollama",
  baseUrl: "http://ollama:11434/v1",
  model: "qwen2.5-coder:7b",
});
```

#### vLLM or an internal gateway

```ts
const ai = openAiCompatibleProvider({
  name: "Private vLLM",
  mode: "local",
  baseUrl: "https://models.internal.example/v1",
  model: "sql-planner",
  apiKey: process.env.INTERNAL_MODEL_TOKEN,
  headers: {
    "X-Tenant": "analytics-platform",
  },
  timeoutMs: 120_000,
});
```

Custom headers are static for the provider instance. Do not place per-user or per-request secrets in a shared provider configuration.

## Provider contract and custom providers

Core depends on this interface:

```ts
import type {
  AiCompletionRequest,
  AiCompletionResponse,
  DashuAiProvider,
} from "@rophpad/dashu-core";

const ai: DashuAiProvider = {
  name: "Company model gateway",
  mode: "internal",
  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    // request.messages, request.maxOutputTokens, request.signal
    return {
      content: "...raw model response...",
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
      },
    };
  },
};
```

`complete` must return the model's text in `content`. Core extracts and validates the JSON query plan. Respect `request.signal` so browser disconnects and explicit cancellation can stop model work. `usage` is optional; the bundled OpenAI-compatible implementation maps `prompt_tokens` and `completion_tokens` when supplied by the server.

## Timeouts, cancellation, and retries

### Provider timeout

The bundled providers default `timeoutMs` to 60 seconds. Each fetch signal combines that timeout with the caller's `AbortSignal` using `AbortSignal.any`. A caller cancellation takes precedence: it is rethrown so core reports `CANCELLED` rather than a provider outage.

A provider timeout is not the same as `statementTimeoutMs`. The provider timeout limits model planning; `statementTimeoutMs` limits SQL execution in PostgreSQL.

### Automatic transport retry

The OpenAI-compatible implementation performs at most one transport retry:

- a network/fetch failure waits 500 ms, then retries once;
- HTTP `408`, `409`, `425`, `500`, `502`, `503`, or `504` waits 800 ms, then retries once;
- HTTP `429` is deliberately not retried, because an immediate retry worsens rate limiting;
- other HTTP failures are not retried.

After a repeated network failure, the provider throws `AI_UNAVAILABLE` with `Could not reach <name>.` Provider HTTP errors are also surfaced as `AI_UNAVAILABLE`, with specific safe messages for rejected credentials (`401`/`403`), exhausted credit (`402`), and rate limiting (`429`). Empty, unreadable, or length-truncated responses are rejected as `AI_UNAVAILABLE`.

There is no configurable retry count or backoff option in the current provider API. If your deployment needs broader retry policy, implement it in a custom `DashuAiProvider` or at an upstream gateway, while still honoring cancellation.

### SQL repair is a different retry

After planning succeeds, a database `QUERY_FAILED` can trigger one new model call containing the failed SQL and driver detail. Timeouts, cancellation, policy rejection, and other non-`QUERY_FAILED` errors do not trigger repair. The corrected SQL is validated before execution. This repair can occur in addition to a provider transport retry, so account for both when sizing request deadlines and model budgets.

## Error-detail privacy

Provider response text used as error detail is whitespace-normalized and truncated to 300 characters before it reaches `DashuError.detail`. HTTP responses include only an error code, safe message, and request ID; they do not serialize `detail`.

The Next.js adapter logs server-only `detail` for diagnostics. Treat server logs as sensitive operational data: even bounded provider errors may echo part of a request, and SQL repair details may include database identifiers or values.

## Production checklist

- Construct providers only in server modules.
- Load API keys and managed credentials from a backend secret manager or environment.
- Use schema policy to remove names the model should not know.
- Review the remote provider's retention and regional controls; Dashu's local code cannot define an external service's policy.
- Set `timeoutMs` below the outer HTTP/platform deadline so Dashu can return a structured failure.
- Ensure the endpoint supports `/chat/completions` and returns a non-empty first choice.
- Use a model capable of following the raw JSON query-plan format and producing SQL for your adapter's dialect.
- Monitor `AI_UNAVAILABLE` by provider mode and request ID without logging questions, prompts, credentials, or rows.
