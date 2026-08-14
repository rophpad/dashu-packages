# Operations and troubleshooting

This guide covers production lifecycle, observability, PostgreSQL pools and schema caching, health checks, shutdown, error diagnosis, and the retry/timeout paths implemented by Dashu.

## Production request path

A normal `ask` request does this:

1. Resolve an approved configured data source.
2. Require the actor's `dashu:ask` permission.
3. Validate and trim the question; reject empty input and questions over 2,000 characters.
4. Resolve policy and introspect the approved schema.
5. Remove denied tables, denied columns, and relationships to hidden tables.
6. Send the planning prompt to the configured provider.
7. Validate generated SQL and wrap it in a hard row limit.
8. Execute inside a PostgreSQL `READ ONLY` transaction with `statement_timeout`.
9. If execution fails with `QUERY_FAILED`, ask the model to repair the SQL once, validate it again, and execute once more.
10. Convert rows to the versioned result contract and emit one metadata event.

An unanswerable question is a successful outcome with `answered: false`; it is not an operational error.

## Deployment model

Create the provider, database adapter, and `createDashu` instance in server-only code. Reuse the instance across requests so the adapter can reuse its process-global connection pool and schema cache.

```ts
import { createDashu } from "@rophpad/dashu-core";
import { postgresAdapter } from "@rophpad/dashu-database-postgres";
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

const analyticsUrl = process.env.DASHU_DATABASE_URL!;

export const dashu = createDashu({
  ai: openRouterProvider({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: "openai/gpt-4.1-mini",
    timeoutMs: 45_000,
  }),
  dataSources: {
    analytics: postgresAdapter({
      connectionString: analyticsUrl,
      schemas: ["analytics"],
      schemaTtlMs: 60_000,
      poolMax: 8,
      connectionTimeoutMs: 10_000,
      applicationName: "example-dashu",
      ipFamily: "4",
    }),
  },
  defaultDataSource: "analytics",
  defaults: {
    maxRows: 200,
    statementTimeoutMs: 10_000,
    exposeSql: false,
    allowExport: false,
    allowSaveDashboard: false,
  },
  maxOutputTokens: 2_000,
  onEvent: recordDashuEvent,
});
```

`createDashu` requires at least one data source. If `defaultDataSource` is absent, the first object key is used. Requests choose sources only by configured key; they cannot supply a connection string. An unknown key fails with `DATA_SOURCE_NOT_CONFIGURED`.

The provider implementation uses `AbortSignal.timeout` and `AbortSignal.any`, whose source comment identifies Node 20+ as the runtime floor.

### Secrets and network placement

Keep provider credentials and database connection strings in backend environment variables or a secret manager. Browser requests should contain only the question and optional follow-up history.

Use a dedicated PostgreSQL role with only the required `CONNECT`, schema `USAGE`, and `SELECT` grants. The adapter adds a SQL guard and a read-only transaction, but database grants are authoritative.

For tenant isolation, select a per-tenant configured connection or schema, or enforce PostgreSQL row-level security. `actor.tenantId` is carried to callbacks and events; it does not automatically add tenant filters.

## PostgreSQL adapter options

| Option | Required | Default | Operational effect |
|---|---:|---|---|
| `connectionString` | Yes | — | Pool/cache identity and connection target. Blank input throws `DATA_SOURCE_NOT_CONFIGURED`. |
| `schemas` | No | `["public"]` | Adapter defaults for introspection when resolved policy has an empty schema list. |
| `schemaTtlMs` | No | `60000` | How long an introspected catalog is reused. |
| `poolMax` | No | `8` | Maximum clients in the `pg.Pool`. |
| `connectionTimeoutMs` | No | `10000` | Pool connection acquisition timeout. |
| `applicationName` | No | `"dashu"` | PostgreSQL `application_name`, useful in database activity views. |
| `ipFamily` | No | `"4"` | `"4"` sets IPv4-first DNS order, `"6"` sets IPv6-first, and `"auto"` leaves Node's order unchanged. |

The pool's idle-client timeout is fixed at 30 seconds. Idle pool errors are written to `console.error` as `[dashu] idle client error <message>`.

## Understand every timeout

Dashu has separate deadlines for separate stages:

| Timeout | Default | Scope | Result |
|---|---:|---|---|
| Provider `timeoutMs` | 60,000 ms | One model fetch | After the one network retry is exhausted, `AI_UNAVAILABLE`; caller abort remains `CANCELLED`. |
| `connectionTimeoutMs` | 10,000 ms | Acquiring/establishing a PostgreSQL pool connection | Described as a connection failure and wrapped as `QUERY_FAILED`. |
| Policy `statementTimeoutMs` | 10,000 ms | SQL execution | PostgreSQL `statement_timeout`; becomes `QUERY_TIMEOUT`. |
| Connection test timeout | 5,000 ms | `SELECT 1` in `testConnection` | Connection/test failure. |
| Introspection timeout | 15,000 ms | Catalog queries | Introspection failure. |
| Outer platform/request timeout | Deployment-specific | Entire HTTP request | Not configured by Dashu; set it above the expected inner work. |

Policy accepts positive finite values, floors them to integers, and caps `statementTimeoutMs` at 120,000 ms. Invalid/non-positive policy values fall back to 10,000 ms. `maxRows` similarly defaults to 200 and is capped at 10,000.

Provider planning can happen twice when SQL repair is needed, and each provider call can itself make one transport retry. Choose the outer request deadline with that worst case in mind. Dashu does not impose one aggregate request timeout.

## Cancellation

`dashuRoute` passes `request.signal` to core. Core passes it to the provider and database adapter.

- The provider combines caller cancellation with its own timeout.
- The PostgreSQL adapter listens for abort and tries `pg_cancel_backend` on the active client's process ID using a second pooled client.
- The transaction is rolled back and the client is released in `finally`.
- Core maps `AbortError` and `TimeoutError` to `CANCELLED` and HTTP status 499.
- `useDashu.cancel()` aborts the browser fetch and does not surface an error in hook state.

The database cancellation attempt can need an extra pool client. Avoid setting `poolMax` so low that an active query leaves no practical capacity for cancellation under load.

## Pools

Pools are stored on `globalThis` in a map keyed by the exact connection string. This provides:

- reuse across adapters created in the same process with the same connection string;
- separate pools for different connection strings;
- concurrency safety between configured data sources.

Because the key is only the connection string, the first pool created for that string determines its `poolMax`, `connectionTimeoutMs`, and `applicationName` for the process. Keep those options consistent anywhere the same connection string is used.

A pool is local to one JavaScript process. If you run multiple workers, containers, or serverless instances, each can create up to `poolMax` clients for each distinct connection string. Capacity-plan the database against process count × configured sources × pool maximum.

### Graceful shutdown

Drain package-created pools with `closePostgresPools`:

```ts
import { closePostgresPools } from "@rophpad/dashu-database-postgres";

async function shutdown(signal: string) {
  console.info(`Received ${signal}; draining Dashu PostgreSQL pools`);
  await closePostgresPools();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
```

`closePostgresPools()` removes and ends every pool created by the package. Pass an exact connection string to close only that pool:

```ts
await closePostgresPools(process.env.DASHU_DATABASE_URL!);
```

Pool `end()` failures are swallowed by this helper. Stop accepting new work before draining; otherwise a later request can create a new pool after the map entry is removed.

## Schema cache

Introspected schemas are cached on `globalThis`. The key combines:

- the exact connection string;
- the sorted list of schemas selected by resolved policy or adapter defaults.

This prevents policies that approve different schema lists from sharing a cached catalog. Denied tables and columns are applied by core after introspection, so they are not part of the adapter's cache key.

A cached entry is reused while `Date.now() - schema.readAt < schemaTtlMs`. Calls with `force: true` bypass the entry and replace it. `dashuSchemaRoute` maps `?refresh=1` to `force: true`.

### Invalidate after migrations or repointing

```ts
import { invalidateSchemaCache } from "@rophpad/dashu-database-postgres";

// Clear entries for one exact connection string.
invalidateSchemaCache(process.env.DASHU_DATABASE_URL!);

// Or clear every cached PostgreSQL catalog in this process.
invalidateSchemaCache();
```

Invalidation is process-local. In a multi-process deployment, call it in every process or rely on the TTL. Closing a pool does not invalidate schema entries, and invalidating schema does not close pools.

For an authorized schema-browser refresh:

```ts
const schema = await dashu.schema({
  actor,
  dataSource: "analytics",
  force: true,
});
```

The actor must have `dashu:view-schema`. `schema()` applies the approved policy before returning the catalog.

## Health and readiness checks

Use `dashu.testConnection(dataSource?)` to run `SELECT 1` inside a read-only transaction with a five-second statement timeout:

```ts
await dashu.testConnection("analytics");
```

Use `dashu.dataSourceNames()` to enumerate configured source keys for startup checks:

```ts
for (const name of dashu.dataSourceNames()) {
  await dashu.testConnection(name);
}
```

A connection test verifies database reachability and credentials, not AI-provider health or schema usability. If readiness must verify schema access, call `dashu.schema` with an authorized service actor; that requires `dashu:view-schema` and can populate the cache. There is no bundled provider health-check method, so avoid spending a model request in a frequent liveness probe.

Do not run a database-dependent check as a high-frequency liveness test if a transient database outage would cause the orchestrator to restart otherwise healthy application processes. Use it as readiness according to your deployment policy.

## Observability

Pass `onEvent` to `createDashu`. After a data source has been resolved, core invokes it once when an `ask` or `run` request finishes as answered, unanswerable, or errored. A failure during initial data-source resolution occurs before this emission path.

```ts
type DashuEvent = {
  requestId: string;
  actorId: string;
  tenantId?: string;
  dataSource: string;
  provider: string;
  dialect: string;
  durationMs: number;
  rowCount?: number;
  status: "answered" | "unanswerable" | "error";
  errorCode?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};
```

Current core emissions include request, actor/tenant, source, provider mode, dialect, duration, status, optional row count, and optional error code. Although `DashuEvent` defines optional `usage`, the current `ask`/`run` implementation does not copy provider token usage into emitted events.

Questions, SQL, result rows, prompts, connection strings, and provider credentials are absent from the event type and core emissions.

```ts
import type { DashuEvent } from "@rophpad/dashu-core";

function recordDashuEvent(event: DashuEvent) {
  metrics.increment("dashu.requests", 1, {
    status: event.status,
    provider: event.provider,
    data_source: event.dataSource,
    dialect: event.dialect,
    error_code: event.errorCode ?? "none",
  });
  metrics.histogram("dashu.duration_ms", event.durationMs, {
    status: event.status,
    provider: event.provider,
  });
  if (event.rowCount !== undefined) {
    metrics.histogram("dashu.rows", event.rowCount, { data_source: event.dataSource });
  }
}
```

The callback is synchronous and its return value is ignored. Core catches callback exceptions so telemetry cannot fail a request. Keep it non-blocking and enqueue work to your telemetry system rather than performing expensive synchronous processing.

`actorId`, `tenantId`, and `dataSource` can be high-cardinality or sensitive identifiers. Prefer logs/traces for per-request fields and low-cardinality dimensions for metrics.

### Request IDs and server logs

Every `ask`/`run` gets a generated `req_…` ID unless the direct caller supplies `requestId`. Results expose it in `meta.requestId`; structured errors expose it as `error.requestId`; events include the same ID.

Use that ID to correlate:

- client error reports;
- `onEvent` telemetry;
- Next.js adapter error logs;
- your surrounding HTTP logs.

The Next.js adapter logs `DashuError.detail` as:

```text
[dashu] <requestId> <code>: <detail>
```

Unhandled errors are logged with `[dashu] <requestId> unhandled`. HTTP responses contain only safe code/message/request ID fields. Server-only detail may contain provider error text or database identifiers and values, so protect and retain these logs accordingly.

## Retry and repair matrix

| Failure | Automatic action |
|---|---|
| Provider fetch/network failure | Wait 500 ms and retry once. |
| Provider HTTP `408`, `409`, `425`, `500`, `502`, `503`, `504` | Wait 800 ms and retry once. |
| Provider HTTP `429` | No retry. Return `AI_UNAVAILABLE` with a rate-limit message. |
| Provider rejects `max_completion_tokens`/`max_tokens` with recognized HTTP 400 text | Switch parameter and retry once; remember per `mode:model` in process memory. |
| PostgreSQL connect error `EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`, or `EPIPE` | Wait 400 ms and retry connection once. |
| SQL execution `QUERY_FAILED` | One model repair call, then revalidate and re-execute once. |
| SQL timeout, cancellation, policy rejection, provider failure | No SQL repair. |

Retries are fixed in source; there are no retry-count options. Account for duplicate provider calls when estimating cost, and rely on event status/error code rather than assuming one outbound call per question.

## Structured errors

The HTTP-safe shape is:

```json
{
  "error": {
    "code": "QUERY_TIMEOUT",
    "message": "That query took too long and was stopped.",
    "requestId": "req_…"
  }
}
```

| Code | HTTP status | Typical meaning / first check |
|---|---:|---|
| `UNAUTHORIZED` | 401 | Defined by core for integrations that distinguish unauthenticated access. |
| `FORBIDDEN` | 403 | `getActor` refused the request, or actor lacks a required Dashu permission. |
| `INVALID_REQUEST` | 400 | Invalid JSON, empty/overlong question, or missing SQL for replay. |
| `AI_NOT_CONFIGURED` | 409 | Managed provider has an empty cloud URL or credential. |
| `AI_UNAVAILABLE` | 502 | Provider network, HTTP, empty, unreadable, or truncated response failure. |
| `DATA_SOURCE_NOT_CONFIGURED` | 409 | No connection string or requested source key is absent. |
| `SCHEMA_UNAVAILABLE` | 409 | No tables remain in approved schemas after filtering. |
| `QUERY_NOT_ALLOWED` | 400 | SQL guard rejected multiple statements, writes/DDL, banned functions, or `SELECT INTO`. |
| `QUERY_TIMEOUT` | 504 | PostgreSQL stopped execution at `statement_timeout`. |
| `QUERY_FAILED` | 400 | Connection failure or SQL still failed after the permitted repair path. |
| `RESULT_LIMIT_EXCEEDED` | 400 | Reserved error code in the public contract; current PostgreSQL path hard-limits and marks truncation instead. |
| `CANCELLED` | 499 | Caller abort or timeout-like abort recognized by core. |
| `INTERNAL` | 500 | Unexpected exception; response text is generic. |

Unknown exceptions are converted to a generic `INTERNAL` response so file paths, connection strings, and stack messages do not leak.

## Troubleshooting by symptom

### `AI_NOT_CONFIGURED`

- Verify `cloudUrl` and `credential` are non-empty after trimming.
- Ensure both are loaded in server code, not a client bundle.
- This code is produced by `managedProvider`; OpenRouter/OpenAI-compatible constructors do not perform equivalent eager empty-option validation.

### Provider credential rejected

HTTP 401 or 403 from an OpenAI-compatible provider becomes `AI_UNAVAILABLE` with `<name> rejected the configured credential.`

- Verify the backend secret value and whether it was rotated or revoked.
- Verify custom `headers` did not override `Authorization` unintentionally; custom headers are merged last.
- For Managed AI, verify the installation credential and cloud URL.
- For OpenRouter, verify the key belongs to the expected account.

### Provider out of credit or rate limited

- HTTP 402 produces an out-of-credit message.
- HTTP 429 produces a rate-limit message and is not automatically retried.
- Back off at the caller or gateway rather than immediately retrying in a loop.
- Group telemetry by `provider` mode and `AI_UNAVAILABLE`; inspect the correlated server detail for the upstream status.

### Could not reach the provider

After one retry, fetch failures become `AI_UNAVAILABLE`.

- Confirm `baseUrl` already includes the required version segment and is reachable from the application process.
- The provider appends `/chat/completions`; do not include that suffix in `baseUrl`.
- In containers, `localhost` means the application container. Use the model service's network name.
- Check DNS, TLS trust, proxy/firewall policy, and whether `timeoutMs` is realistic for the model.
- Confirm the endpoint implements OpenAI-style `choices[0].message.content`.

### Unreadable, empty, or cut-off model response

The provider rejects invalid JSON responses, empty first-choice content, and `finish_reason: "length"`.

- Confirm the server returns JSON in the expected OpenAI-compatible shape.
- Increase `createDashu({ maxOutputTokens })` if valid plans are being cut off; the default is 2,000.
- Choose a model that can follow the raw JSON plan instructions.
- If the endpoint only supports `max_tokens`, the built-in provider should detect a recognized 400 rejection and switch automatically. Inspect detail if its rejection wording is not recognized.

### `DATA_SOURCE_NOT_CONFIGURED`

- Ensure `createDashu.dataSources` contains at least one entry.
- Verify `defaultDataSource` and `selectDataSource` return an exact configured key.
- Ensure `connectionString` is not blank.
- Use `dashu.dataSourceNames()` to inspect keys without exposing connection strings.

### `SCHEMA_UNAVAILABLE`

This means no approved tables remained for planning.

- Check `schemas` against actual PostgreSQL schema names.
- Review `denyTables` and `denyColumns`; a table with all columns denied is removed.
- Confirm the analytics role can read the catalog and has access to intended objects.
- Invalidate/force-refresh after migrations or connection repointing.
- Use `dashu.schema({ actor, force: true })` with `dashu:view-schema` to inspect the filtered result.

### `ENOTFOUND` / “No such host”

The adapter translates `ENOTFOUND` to a hostname-specific safe message.

- Check the connection-string hostname for typos.
- Check container/service DNS naming.
- Do not log the full connection string while diagnosing; it may contain a password.

### `EAI_AGAIN` / temporary DNS failure

`EAI_AGAIN` is retried once after 400 ms.

- If persistent, inspect resolver health and container DNS configuration.
- Check whether short-lived serverless/container DNS failures correlate with deploys.
- Repeated failures ultimately surface as `QUERY_FAILED`.

### `ECONNREFUSED`

- Confirm PostgreSQL is listening on the configured port.
- Inside Docker, replace database `localhost` with the database service name unless PostgreSQL is in the same container.
- Check network policy and port publishing.

### Database connection `ETIMEDOUT`

Connection timeout is retried once. The safe message calls out firewall/IP allow-list and unroutable IPv6 as common causes.

- Verify provider/database IP allow-lists and firewall routes.
- The adapter defaults to IPv4-first because Docker bridge networks often lack IPv6 routing.
- Use `ipFamily: "auto"` only when Node's default order is appropriate, or `"6"` when IPv6-first is intentional.
- Increase `connectionTimeoutMs` only after resolving routing and capacity causes.

### TLS errors or reset connections

- `ECONNRESET` advises adding `?sslmode=require` when the server requires TLS.
- Certificate verification errors report that the host certificate could not be verified.
- Install the correct CA/trust configuration rather than disabling verification as a routine fix.
- Verify the connection hostname matches the certificate.

### PostgreSQL authentication and authorization

The adapter maps common PostgreSQL codes:

- `28P01`: password authentication failed;
- `28000`: server rejected the analytics role;
- `3D000`: database does not exist;
- `42501`: role needs `CONNECT`, schema `USAGE`, and `SELECT` on approved objects;
- `53300`: server has too many clients.

For `53300`, calculate aggregate pool capacity across every process and connection string. Reduce `poolMax`, process count, or use an appropriate external pooler/database limit.

### `QUERY_NOT_ALLOWED`

The SQL guard permits one read-only statement beginning with `SELECT`, `WITH`, `TABLE`, or `(`. It rejects:

- multiple statements;
- write, DDL, transaction, session, and data-modifying CTE statements;
- `SELECT ... INTO`;
- listed filesystem, network, sleep, backend-control, and state-mutating functions.

The query then runs in `BEGIN TRANSACTION READ ONLY`, so do not bypass the guard to make generated writes work. Reframe the question as analytics, expose an approved view, or fix a custom provider/model that emits unsupported SQL.

### `QUERY_TIMEOUT`

- Inspect query shape and database indexes using authorized server-side tooling.
- Reduce schema ambiguity or add semantic vocabulary so planning chooses appropriate joins.
- Increase `statementTimeoutMs` only within its 120-second cap and only after reviewing load impact.
- SQL repair is deliberately skipped for timeouts because retrying would spend the budget again.

### `QUERY_FAILED`

Core normally gives a failed generated query one repair attempt. The browser receives a safe message; the database driver text remains in server-only detail and is also sent to the provider for that repair.

- Correlate by request ID and inspect protected server logs.
- Verify schema cache freshness after migrations.
- Confirm the role can access all objects exposed to the model.
- Review custom views, enum values, and comments used by the schema prompt.
- If the failure is a connection problem, use the translated connection message rather than assuming generated SQL is at fault.

### Result has only the first rows

Every validated query is wrapped as:

```sql
SELECT * FROM (
  -- generated query
) AS dashu_result LIMIT <maxRows>
```

When the adapter receives exactly the limit, result conversion can report truncation and the table displays “Showing the first … rows.” Increase policy `maxRows` carefully, up to the 10,000 ceiling, or ask a more aggregated question. For UI charts, `toPoints` separately displays at most 30 points, and pie charts reduce to at most eight slices.

### SQL/export/save controls do not appear

Disclosure is an intersection, not a request-controlled override.

- The actor needs `dashu:view-sql`, `dashu:export`, or `dashu:save-dashboard` respectively.
- Instance defaults must also enable `exposeSql`, `allowExport`, or `allowSaveDashboard`.
- Per-request policy can set a flag to `false`, but cannot widen a disabled default.
- `query` is absent unless SQL disclosure is allowed; `DashuResult showSql` cannot recreate it.

### Follow-ups do not accumulate

`useDashu` adds history only for answered results carrying `query.sql`.

- Ensure `keepHistory` is true.
- SQL disclosure must be permitted by actor permission and policy.
- Unanswerable and failed requests do not enter history.
- `reset()` clears history; a page reload also loses it because the hook does not persist state.
- Only the latest six turns are retained.

### Cancellation does not stop database work promptly

- Ensure your HTTP framework passes a meaningful abort signal. `dashuRoute` uses `request.signal`.
- Ensure a spare pool client can be acquired for `pg_cancel_backend`.
- PostgreSQL `statement_timeout` is the final bound if active cancellation cannot obtain a client.
- Confirm the browser actually aborts the request; `useDashu.cancel` does.

## Operational checklist

### Before deployment

- Test every configured source with `testConnection`.
- Verify an authorized schema call returns only approved objects.
- Use a dedicated read-only database role and purpose-built views.
- Set provider, connection, statement, and platform deadlines deliberately.
- Capacity-plan pools across all runtime processes.
- Wire metadata-only `onEvent` metrics and request-ID correlation.
- Keep secrets and server-only error detail out of client logs.

### After schema changes

- Run the migration.
- Invalidate the process-local schema cache or force an authorized refresh.
- Repeat this in every long-lived process, or wait for `schemaTtlMs`.
- Ask a representative question and monitor for `QUERY_FAILED` repair activity.

### During shutdown

- Stop accepting new requests.
- Allow or cancel in-flight requests according to your server policy.
- Call `closePostgresPools()`.
- Exit after pool draining completes or your process manager's grace period expires.
