# Errors and statuses

Dashu uses thrown `DashuError` instances inside server packages and a redacted JSON envelope at HTTP boundaries. An unanswerable question is a successful [`AskUnanswerable`](./result-contract.md#askunanswerable), not an error.

Source: [`packages/core/src/errors.ts`](../../packages/core/src/errors.ts). Route serialization: [`packages/adapter-next/src/index.ts`](../../packages/adapter-next/src/index.ts).

## `DashuError`

```ts
type DashuErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "AI_NOT_CONFIGURED"
  | "AI_UNAVAILABLE"
  | "DATA_SOURCE_NOT_CONFIGURED"
  | "SCHEMA_UNAVAILABLE"
  | "QUERY_NOT_ALLOWED"
  | "QUERY_TIMEOUT"
  | "QUERY_FAILED"
  | "RESULT_LIMIT_EXCEEDED"
  | "CANCELLED"
  | "INTERNAL";

class DashuError extends Error {
  readonly code: DashuErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly detail?: string;

  constructor(
    code: DashuErrorCode,
    message: string,
    options?: { requestId?: string; detail?: string; cause?: unknown },
  );

  withRequestId(requestId: string): DashuError;
}
```

`status` is derived solely from `code`. `message` is intended for callers. `detail` and `cause` are server/operator context and are not serialized by core. `withRequestId` returns the same object when it already has an ID; otherwise it returns a new `DashuError` preserving code, message, detail, and cause.

```ts
try {
  await dashu.ask(request);
} catch (error) {
  const requestId = error instanceof DashuError && error.requestId
    ? error.requestId
    : "req_unknown";
  return Response.json(toErrorResponse(error, requestId), {
    status: errorStatus(error),
  });
}
```

## Code and HTTP status reference

| Code | HTTP | Meaning and current producers |
|---|---:|---|
| `UNAUTHORIZED` | 401 | Declared for missing/invalid authentication. No current package constructs it; the Next adapter maps `getActor() === null` to `FORBIDDEN` instead. Hosts may construct it when appropriate. |
| `FORBIDDEN` | 403 | Authenticated actor is not permitted. Produced by `requirePermission`; the Next adapter also uses it when `getActor` returns null, with `Administrator access is required.` |
| `INVALID_REQUEST` | 400 | Invalid caller input. Core emits it for empty questions, questions over 2,000 characters, or empty SQL; Next emits it for malformed JSON. Non-string body fields become empty strings and then reach the corresponding core validation. |
| `AI_NOT_CONFIGURED` | 409 | AI setup is absent. Currently produced by `managedProvider` when trimmed `cloudUrl` or `credential` is empty. Other providers do not pre-validate configuration. |
| `AI_UNAVAILABLE` | 502 | Provider/network/protocol/plan failure. Includes unreachable endpoints after retry, provider non-2xx responses, unreadable or empty completion payloads, length-truncated completions, and model output with no parseable JSON object. |
| `DATA_SOURCE_NOT_CONFIGURED` | 409 | Missing/unknown source configuration. Produced for an unknown selected source and for an empty PostgreSQL connection string. |
| `SCHEMA_UNAVAILABLE` | 409 | No usable approved schema. Core currently emits it when schema policy filtering leaves no tables for `ask`. A schema-browser call may validly return an empty schema instead. |
| `QUERY_NOT_ALLOWED` | 400 | SQL guard rejected a statement before execution: empty SQL after cleaning, multiple statements, non-read-only start/write statement, banned function, or `SELECT ... INTO`. |
| `QUERY_TIMEOUT` | 504 | PostgreSQL reported SQLSTATE `57014` during execution and the caller signal was not aborted. Message: `That query took too long and was stopped.` |
| `QUERY_FAILED` | 400 | Database connection or query execution failed. During `ask`, core gives the model one repair attempt for this code; `run` does not repair. Driver/provider-sensitive details remain in `detail`. |
| `RESULT_LIMIT_EXCEEDED` | 400 | Declared for a hard result-limit failure, but no current package constructs it. Current PostgreSQL behavior limits rows and marks `data.truncated` rather than throwing. |
| `CANCELLED` | 499 | Core recognized an `AbortError` or `TimeoutError` escaping `ask`/`run`. 499 is a non-standard client-closed-request convention. Provider caller aborts and PostgreSQL signal cancellation are intended to reach this mapping. |
| `INTERNAL` | 500 | Unexpected error. Core wraps unknown throws from `ask`/`run`; serializers also map unknown errors to a generic internal response. |

The table is exhaustive for `DashuErrorCode`, including the two codes not currently emitted by repository code (`UNAUTHORIZED`, `RESULT_LIMIT_EXCEEDED`).

## Error response contract

```ts
type DashuErrorResponse = {
  error: {
    code: DashuErrorCode;
    message: string;
    requestId?: string;
  };
};
```

Example:

```json
{
  "error": {
    "code": "QUERY_NOT_ALLOWED",
    "message": "Only one statement can be run at a time; multiple were detected.",
    "requestId": "req_example"
  }
}
```

`toErrorResponse(error, requestId)` behaves as follows:

- for `DashuError`, it returns that error's `code` and `message`, but always uses the function argument as the response request ID rather than `error.requestId`;
- for anything else, it returns `INTERNAL`, `Something went wrong handling that question.`, and the supplied ID;
- it never serializes `status`, `detail`, `cause`, stack, provider payloads, prompts, connection strings, or driver messages.

`errorStatus(error)` returns the mapped `DashuError.status`, otherwise 500.

The Next adapter uses both helpers. If an error has no attached request ID—common for route-level authentication or JSON errors—it returns `req_unknown`. It logs `DashuError.detail` when present; unknown errors are logged as objects. Ensure server logs have suitable access controls because details can include database/provider diagnostics.

## Messages produced by current packages

Messages are API-visible text but should not be used as machine identifiers; branch on `code`.

### Core/request messages

- `FORBIDDEN`: `You do not have permission to do that.`
- `INVALID_REQUEST`: `Ask a question first.`, `That question is too long.`, or `No SQL to run.`
- `DATA_SOURCE_NOT_CONFIGURED`: `No data source named "<key>" is configured.`
- `SCHEMA_UNAVAILABLE`: `No tables are available in the approved schemas.`
- `QUERY_FAILED`: `That query could not be run against this database.`
- `CANCELLED`: `The request was cancelled.`
- `INTERNAL`: `Something went wrong handling that question.`
- `AI_UNAVAILABLE` from JSON extraction: `The model did not return a usable query plan.`

`createDashu` with zero sources is the notable exception: it throws a plain `Error("createDashu requires at least one data source.")` at construction time, not `DashuError`.

### Next route messages

- `FORBIDDEN`: `Administrator access is required.` when `getActor` returns null.
- `INVALID_REQUEST`: `Invalid JSON body.` for failed body parsing.

Errors thrown by route callbacks (`getActor`, source/policy/semantic callbacks, or `onAnswer`) are serialized according to whether they are `DashuError`; unknown callback errors become redacted `INTERNAL`/500.

### PostgreSQL guard messages

The exact message names the rejected shape where useful:

- no SQL: `No SQL was produced for that question.`
- multiple statements: `Only one statement can be run at a time; multiple were detected.`
- invalid start: `Dashu only runs read-only queries. This statement starts with "<token>".`
- write statement: `Dashu only runs read-only queries. Found a "<KEYWORD>" statement.`
- banned function: `The function <name>() is not permitted.`
- table creation: `SELECT ... INTO is not allowed — it creates a table.`

Trailing semicolons are removed and accepted; only a remaining semicolon outside normalized literals/comments triggers the multiple-statement error.

### PostgreSQL connection/query messages

Connection failures are `QUERY_FAILED`, with credential-free public messages for temporary DNS failure, unknown host, refused/timed-out/reset connection, TLS certificate failure, authentication/role rejection, missing database, permission denial, too many clients, or a generic `Could not reach the database at <host:port>.` The connection string itself is not interpolated. PostgreSQL execution failures use `That query could not be run against this database.` and put the driver message in `detail`.

A connection failure during `ask` is also `QUERY_FAILED`, so core currently treats it as repairable and can spend one extra model call before the second execution fails. Connection/query failures during `run`, schema introspection, or connection testing are not model-repaired.

PostgreSQL SQLSTATE `57014` represents both statement timeout and cancellation. The adapter first calls `executeOptions.signal?.throwIfAborted()`; if the caller signal is aborted, core maps the resulting abort to `CANCELLED`, otherwise it emits `QUERY_TIMEOUT`.

### Provider messages and upstream HTTP status handling

The OpenAI-compatible provider converts every non-success response to `AI_UNAVAILABLE`/502 in Dashu's error model; it does not preserve the upstream status as the outward HTTP status.

| Upstream condition | Retry | Public message |
|---|---:|---|
| network error or provider timeout | once after 500 ms | `Could not reach <name>.` |
| 408, 409, 425, 500, 502, 503, 504 | once after 800 ms | `<name> could not complete the request.` after retry |
| 400 rejecting token parameter | switch parameter once | only errors if switched request also fails |
| 401 or 403 | no | `<name> rejected the configured credential.` |
| 402 | no | `<name> reports that this account is out of credit.` |
| 429 | no | `<name> is rate limiting this installation. Try again shortly.` |
| other non-2xx | no | `<name> could not complete the request.` |
| success with invalid JSON | no | `<name> returned an unreadable response.` |
| missing/blank first-choice content | no | `<name> returned an empty response.` |
| `finish_reason: "length"` | no | `The model response was cut off before it finished.` |

Upstream response detail is normalized, truncated to 300 characters, and stored only in `detail`. A caller-initiated abort is rethrown rather than converted to `AI_UNAVAILABLE`. The provider's own timeout uses an abort signal; after one retry, it normally becomes `AI_UNAVAILABLE`, because only the caller's signal is checked as caller cancellation.

Managed configuration has one additional message: `Managed AI is unavailable until this installation is connected to Dashu Cloud.` (`AI_NOT_CONFIGURED`).

## Non-error statuses

### Result answer status

`AskResult.answered` has two states:

- `true` — query ran and produced an `AskAnswered`, including when it returned zero rows;
- `false` — model declined because the approved schema could not answer; HTTP remains 200 in the Next adapter.

### `DashuEvent.status`

```ts
status: "answered" | "unanswerable" | "error";
```

- `answered`: successful `ask` or `run`; includes `rowCount`.
- `unanswerable`: successful model decline from `ask`; no `rowCount`.
- `error`: failed `ask` or `run`; includes `errorCode`.

Events are not emitted for `schema` or `testConnection`. `onEvent` exceptions are swallowed. The event `errorCode` property is typed as `string`, though core supplies a `DashuErrorCode` value.

### Next route success statuses

All three handlers return HTTP 200 on success:

- `dashuRoute`: raw `AskAnswered` or `AskUnanswerable`;
- `dashuRunRoute`: raw successful run result;
- `dashuSchemaRoute`: `{ version: "1", schema: DatabaseSchema }`.

There are no 201/204/redirect responses in these handlers.

## Client-hook error behavior

`useDashu` reads non-2xx JSON shaped as `{error: DashuErrorPayload}`. Its exported payload uses `code: string`, not the narrower core union. If the body is absent, invalid JSON, or lacks `error`, it exposes:

```ts
{ code: "INTERNAL", message: "Something went wrong. Please try again." }
```

Network failures use the same generic payload. Browser `AbortError` is silent: `ask` resolves `null`, `onError` is not called, and no hook error is set. All failure paths resolve `AskResult | null`; the hook does not throw fetch/HTTP failures.

## Handling recommendations

```ts
try {
  const result = await dashu.ask(request);
  if (!result.answered) return { kind: "unanswerable", text: result.answer.text };
  return { kind: "answer", result };
} catch (unknown) {
  const error = unknown instanceof DashuError
    ? unknown
    : new DashuError("INTERNAL", "Something went wrong handling that question.", { cause: unknown });

  logger.error({ requestId: error.requestId, code: error.code, detail: error.detail });
  return { kind: "error", status: error.status, body: toErrorResponse(error, error.requestId ?? "req_unknown") };
}
```

- Branch on `code`, never public message text.
- Keep `detail`, `cause`, and stack traces server-side.
- Preserve/return request IDs so users and operators can correlate failures.
- Do not retry `QUERY_NOT_ALLOWED`, `INVALID_REQUEST`, `FORBIDDEN`, or immediate 429s without changing input/permissions or backing off.
- Treat 499 as a convention; some platforms may rewrite or not recognize it.
- Do not mistake `data.truncated` for `RESULT_LIMIT_EXCEEDED`: current row caps are successful answered results.
