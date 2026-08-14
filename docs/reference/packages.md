# Package API reference

Dashu is published as seven packages. Every package exposes one root entry point (`.`) plus `./package.json`, ships ESM and CommonJS builds with declarations, targets ES2022, and is marked side-effect-free. Import only from package roots; source-file subpaths are not package exports.

- [`@rophpad/dashu-core`](#rophpaddashu-core) — request-scoped policy, planning, execution, and contracts
- [`@rophpad/dashu-database-postgres`](#rophpaddashu-database-postgres) — PostgreSQL adapter
- [`@rophpad/dashu-provider-openai-compatible`](#rophpaddashu-provider-openai-compatible) — generic chat-completions provider
- [`@rophpad/dashu-provider-openrouter`](#rophpaddashu-provider-openrouter) — OpenRouter configuration
- [`@rophpad/dashu-provider-managed`](#rophpaddashu-provider-managed) — Dashu Cloud managed AI
- [`@rophpad/dashu-next`](#rophpaddashu-next) — Next.js route handlers
- [`@rophpad/dashu-react`](#rophpaddashu-react) — React hook, composer, and renderers

See [Result contract](./result-contract.md) and [Errors and statuses](./errors.md) for the shared wire contracts.

## `@rophpad/dashu-core`

Source: [`packages/core/src/index.ts`](../../packages/core/src/index.ts)

### `createDashu(config)`

```ts
import { createDashu, PERMISSIONS } from "@rophpad/dashu-core";
import { postgresAdapter } from "@rophpad/dashu-database-postgres";
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

const dashu = createDashu({
  ai: openRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY!, model: "openai/gpt-4.1-mini" }),
  dataSources: {
    analytics: postgresAdapter({ connectionString: process.env.DATABASE_URL! }),
  },
  defaultDataSource: "analytics",
  defaults: { maxRows: 200, statementTimeoutMs: 10_000 },
});

const result = await dashu.ask({
  question: "Revenue by month",
  actor: { id: "admin-1", permissions: [PERMISSIONS.ask] },
});
```

```ts
type DashuConfig = {
  ai: DashuAiProvider;
  dataSources: Record<string, DashuDatabaseAdapter>;
  defaultDataSource?: string;
  defaults?: DashuPolicyInput;
  maxOutputTokens?: number;
  onEvent?: (event: DashuEvent) => void;
};
```

- At least one data source is required; otherwise construction throws a plain `Error`.
- Source selection is `request.dataSource`, then `defaultDataSource`, then the first key in `dataSources`.
- `maxOutputTokens` defaults to `2000` per planning call.
- `onEvent` receives metadata only. Exceptions from it are swallowed so observability cannot fail a request.
- Configuration and requests are explicit and request-scoped; `tenantId` is carried to callbacks/events but does not itself isolate database rows.

`createDashu` returns `Dashu`:

```ts
type Dashu = {
  ask(request: AskRequest): Promise<AskResult>;
  run(request: RunRequest): Promise<AskResult>;
  schema(request: {
    actor: DashuActor;
    dataSource?: string;
    policy?: DashuPolicyInput;
    force?: boolean;
  }): Promise<DatabaseSchema>;
  testConnection(dataSource?: string): Promise<void>;
  dataSourceNames(): string[];
};
```

#### `dashu.ask(request)`

Requires `dashu:ask` (or the legacy `askdb:ask` alias). Questions are trimmed, must be non-empty, and are limited to 2,000 characters. At most the last six history turns are sent to the model. The flow introspects and filters the schema, asks the provider for one read-only plan, validates and executes it, and makes one model repair attempt only when execution fails with `QUERY_FAILED`. Timeouts and cancellations are not repaired.

```ts
type AskRequest = {
  question: string;
  actor: DashuActor;
  dataSource?: string;
  policy?: DashuPolicyInput;
  history?: AskTurn[];
  semantic?: SemanticLayer;
  signal?: AbortSignal;
  requestId?: string;
};

type AskTurn = { question: string; sql: string };
type SemanticLayer = { terms: Record<string, string>; notes: string[] };
```

An empty planned SQL string is a successful, unanswerable result rather than an exception. See [Result unions](./result-contract.md#askresult).

#### `dashu.run(request)`

Replays stored SQL without calling the model. It still requires ask permission and re-validates the SQL under the current policy.

```ts
type RunRequest = {
  sql: string;
  actor: DashuActor;
  dataSource?: string;
  policy?: DashuPolicyInput;
  display?: DisplaySpec;
  signal?: AbortSignal;
  requestId?: string;
};
```

The default display is `table`; the answer text is empty. Despite its declared `Promise<AskResult>`, current successful execution always returns `AskAnswered`.

#### `dashu.schema(request)`

Requires `dashu:view-schema` (or `askdb:view-schema`), introspects the selected source, applies table/column denials, and returns `DatabaseSchema`. `force: true` asks the adapter to bypass its cache. Unlike `ask`/`run`, disclosure flags are resolved from instance/request policy only and are irrelevant to the schema output.

#### `dashu.testConnection(dataSource?)`

Calls the selected adapter's connection test. It performs no actor or permission check.

#### `dashu.dataSourceNames()`

Returns a fresh array of configured source keys in object-key order.

### Actors and permissions

```ts
type DashuActor = {
  id: string;
  tenantId?: string;
  permissions: readonly string[];
};

const PERMISSIONS = {
  ask: "dashu:ask",
  viewSchema: "dashu:view-schema",
  viewSql: "dashu:view-sql",
  export: "dashu:export",
  saveDashboard: "dashu:save-dashboard",
} as const;
```

`policyForActor(actor)` maps the three disclosure permissions to policy flags. `requirePermission(actor, permission)` returns `void` or throws `FORBIDDEN`. Both functions accept corresponding `askdb:*` legacy aliases.

Authentication is the host's responsibility. Actor fields must be derived server-side, not accepted from a request body.

### Policy API

```ts
type SchemaPolicy = {
  schemas: string[];
  denyTables: string[];   // schema.table
  denyColumns: string[];  // schema.table.column; table.column is also matched
};
type QueryPolicy = { maxRows: number; statementTimeoutMs: number };
type DisclosurePolicy = {
  exposeSql: boolean;
  allowExport: boolean;
  allowSaveDashboard: boolean;
};
type DashuPolicy = SchemaPolicy & QueryPolicy & DisclosurePolicy;
type DashuPolicyInput = Partial<DashuPolicy>;
```

`POLICY_DEFAULTS` is:

```ts
{
  schemas: [], denyTables: [], denyColumns: [],
  maxRows: 200, statementTimeoutMs: 10_000,
  exposeSql: false, allowExport: false, allowSaveDashboard: false,
}
```

`resolvePolicy(defaults, request)` normalizes and merges policy:

- invalid/non-positive numeric values fall back to the built-in default; values are floored;
- `maxRows` is capped at `10_000`; `statementTimeoutMs` at `120_000`;
- names are stringified, trimmed, deduplicated, and empty names removed;
- request `schemas`, when truthy (including `[]`), replaces default schemas;
- deny lists append request entries to defaults;
- disclosure flags can be narrowed by a request but never widened beyond truthy defaults.

For `ask` and `run`, actor disclosure is shallow-merged over configured defaults before request policy is resolved. Consequently, actor permission is required for a capability even if the instance default enables it.

`applySchemaPolicy(schema, policy)` removes denied tables and columns case-insensitively, removes tables left with zero columns, and removes relationships touching hidden tables. It returns the original schema object unchanged when both deny lists are empty. This limits model/schema disclosure; database grants, separate schemas/connections, or row-level security remain the actual security boundary.

### Provider contracts

```ts
type AiMessage = { role: "system" | "user" | "assistant"; content: string };
type AiCompletionRequest = {
  messages: AiMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
};
type AiCompletionResponse = {
  content: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};
type DashuAiProvider = {
  name: string;
  mode: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
};
```

`name` is human-readable; `mode` is written to result metadata/events. Core currently does not copy provider token usage into `DashuEvent`, although the event type allows it.

### Database contracts

```ts
type Cell = string | number | boolean | null;
type QueryResult = { columns: string[]; rows: Cell[][] };
type ValidatedQuery = { sql: string; executable: string; limit: number };

interface DashuDatabaseAdapter {
  dialect: string;
  testConnection(): Promise<void>;
  introspect(policy: SchemaPolicy, options?: { force?: boolean }): Promise<DatabaseSchema>;
  renderSchema(schema: DatabaseSchema): string;
  promptRules(): string;
  validate(sql: string, policy: QueryPolicy): ValidatedQuery;
  execute(
    query: ValidatedQuery,
    options: { maxRows: number; timeoutMs: number; signal?: AbortSignal },
  ): Promise<QueryResult>;
}
```

Rows are positional so duplicate column names remain distinct. Adapter authors should enforce read-only behavior independently of prompt instructions and validation.

Schema types are:

```ts
type SchemaColumn = {
  name: string; type: string; nullable: boolean; isPrimaryKey: boolean;
  enumValues?: string[]; comment?: string;
};
type SchemaTable = {
  schema: string; name: string; kind: "table" | "view";
  columns: SchemaColumn[]; comment?: string;
};
type SchemaRelationship = {
  fromSchema: string; fromTable: string; fromColumn: string;
  toSchema: string; toTable: string; toColumn: string;
};
type DatabaseSchema = {
  tables: SchemaTable[];
  relationships: SchemaRelationship[];
  readAt: number;
};
```

### Planning and utility exports

- `planQuery(provider, request): Promise<QueryPlan>` builds the system/user messages and parses the provider response. `PlanRequest` requires `question`, `dialectRules`, `schemaPrompt`, `maxOutputTokens`, and optionally accepts `semantic`, `history`, `repair: {sql,error}`, and `signal`. Returned SQL is trimmed/capped at 20,000 characters, explanation at 600, title at 120, and axis keys at 200. Unknown display types become `table`.
- `semanticToPrompt(layer)` formats terms and notes as prompt text, or returns `""` for `undefined`.
- `extractJson<T>(text)` accepts raw JSON, a JSON/untagged fenced block, or the first balanced JSON object outside string escapes. It performs parsing, not runtime shape validation, and throws `AI_UNAVAILABLE` if none parse.
- `resolveDisplay(suggestion, data)` validates display shape against actual data. Full rules are in [Display resolution](./result-contract.md#display-resolution).
- `toResultData(result, limit)` converts positional rows to the public keyed data contract. Full rules are in [Data conversion](./result-contract.md#data-conversion).
- `QueryPlan` is `{ sql: string; explanation: string; display: DisplaySpec }`.

All result/display/error types exported by core are documented in [Result contract](./result-contract.md) and [Errors](./errors.md).

### Events

```ts
type DashuEvent = {
  requestId: string; actorId: string; tenantId?: string;
  dataSource: string; provider: string; dialect: string;
  durationMs: number; rowCount?: number;
  status: "answered" | "unanswerable" | "error";
  errorCode?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};
```

One event is emitted for each completed `ask`/`run`. `rowCount` is supplied for answered results; `errorCode` for errors. `schema` and `testConnection` do not emit events.

## `@rophpad/dashu-database-postgres`

Source: [`packages/database-postgres/src/index.ts`](../../packages/database-postgres/src/index.ts)

This is a Node PostgreSQL adapter using `pg` and Node DNS APIs.

### `postgresAdapter(options)`

```ts
type PostgresAdapterOptions = {
  connectionString: string;
  schemas?: string[];
  schemaTtlMs?: number;
  poolMax?: number;
  connectionTimeoutMs?: number;
  applicationName?: string;
  ipFamily?: string;
};
```

Defaults: schemas `['public']` when omitted/empty, schema TTL `60_000`, pool maximum `8`, idle timeout `30_000`, connection timeout `10_000`, application name `dashu`, and IP family `"4"`. `ipFamily: "6"` requests IPv6-first ordering; `"auto"` leaves Node ordering unchanged; any other value currently selects IPv4-first. The DNS preference changes Node's process-wide default result order.

An empty connection string throws `DATA_SOURCE_NOT_CONFIGURED`. Pools are global and keyed by exact connection string; schema cache entries are global and keyed by connection string plus sorted schema list. Existing pools are reused, so later adapter instances for the same string do not replace the first pool's sizing/timeouts/application name.

Behavior:

- transient connection errors `EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`, and `EPIPE` are retried once after 400 ms;
- tests use `SELECT 1` with a 5-second read-only transaction;
- introspection uses a 15-second read-only transaction and includes ordinary/partitioned tables, views, materialized views, columns, PK flags, comments, enum labels, and foreign keys; partition children are omitted;
- table/column comments are whitespace-normalized and capped at 160 characters; rendered enums show at most 25 labels;
- execution uses `BEGIN TRANSACTION READ ONLY`, a local `statement_timeout`, positional rows, and always rolls back;
- abort attempts `pg_cancel_backend` from a second connection;
- dates become ISO strings, buffers become PostgreSQL-style `\\x...` hex, numerics/bigints remain strings, and other objects are JSON-stringified;
- SQL execution happens through the guard's outer `LIMIT`, but the `ResultData.truncated` flag is conservative: exactly `limit` rows is reported as truncated even if no additional row exists.

Use a database role with only the needed `CONNECT`, schema `USAGE`, and table/view `SELECT` grants.

### `guard(rawSql, policy)`

Trims whitespace and trailing semicolons, accepts one statement starting with `SELECT`, `WITH`, `TABLE`, or `(`, rejects semicolons remaining outside comments/literals, write statements in executable statement positions, `SELECT ... INTO`, and a fixed set of filesystem/network/delay/server-state functions. It ignores keywords inside comments, string literals, dollar strings, and quoted identifiers.

It returns:

```ts
{
  sql: cleanedOriginal,
  executable: `SELECT * FROM (\n${cleanedOriginal}\n) AS dashu_result LIMIT ${policy.maxRows}`,
  limit: policy.maxRows,
}
```

The guard is intentionally defense in depth, not a full SQL parser or sole security boundary; execution's read-only transaction and database grants remain authoritative.

### Cache/pool utilities

- `closePostgresPools(connectionString?)` drains and removes one exact pool, or all pools when omitted. Pool shutdown errors are ignored. It does not clear schema cache entries.
- `invalidateSchemaCache(connectionString?)` clears cache entries for one connection string, or all entries when omitted. It does not close pools.

### Identifier/schema utilities

- `quoteIdent(name)` leaves safe lowercase non-reserved identifiers bare; otherwise it double-quotes and doubles embedded quotes.
- `renderSchema(schema)` emits compact PostgreSQL prompt text with qualified names, types, PK/nullability flags, enum values, comments, and relationships.

## `@rophpad/dashu-provider-openai-compatible`

Source: [`packages/provider-openai-compatible/src/index.ts`](../../packages/provider-openai-compatible/src/index.ts)

### `openAiCompatibleProvider(options)`

```ts
type OpenAiCompatibleOptions = {
  name: string;
  mode?: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};
```

Defaults: `mode: "local"`, timeout `60_000`. The endpoint is the base URL with trailing slashes removed plus `/chat/completions`. Requests contain `model`, `messages`, and an output-token parameter. `Content-Type` and optional bearer authorization are set first, then `headers` are spread over them, so custom headers can override either.

The client initially uses `max_completion_tokens`; if a 400 response explicitly says that token parameter is unsupported/unknown, it switches to `max_tokens` (or back) and remembers the choice globally per `mode:model`.

Network/timeout failures are retried once after 500 ms. HTTP 408, 409, 425, 500, 502, 503, and 504 are retried once after 800 ms; 429 is deliberately not retried. Caller aborts propagate so core can classify them as `CANCELLED`. Provider error detail is whitespace-normalized and capped at 300 characters. Unreadable JSON, empty content, and `finish_reason: "length"` become `AI_UNAVAILABLE`.

Runtime requires global `fetch`, `AbortSignal.timeout`, and `AbortSignal.any`; the source identifies Node 20+ as the floor.

## `@rophpad/dashu-provider-openrouter`

Source: [`packages/provider-openrouter/src/index.ts`](../../packages/provider-openrouter/src/index.ts)

### `openRouterProvider(options)`

```ts
type OpenRouterOptions = {
  apiKey: string;
  model: string;
  referer?: string;
  title?: string;
  timeoutMs?: number;
};
```

Wraps the OpenAI-compatible provider with name `OpenRouter`, mode `openrouter`, and base URL `https://openrouter.ai/api/v1`. `HTTP-Referer` defaults to `https://dashu.dev`; `X-Title` defaults to `Dashu`; timeout inherits the shared client's 60-second default. The function does not pre-validate empty keys or model names; rejection occurs at the remote endpoint. Keep the key server-side.

## `@rophpad/dashu-provider-managed`

Source: [`packages/provider-managed/src/index.ts`](../../packages/provider-managed/src/index.ts)

### `managedProvider(options)`

```ts
type ManagedOptions = {
  cloudUrl: string;
  credential: string;
  model?: string;
  timeoutMs?: number;
};
```

Trims both required values, removes trailing slashes from `cloudUrl`, and throws `AI_NOT_CONFIGURED` when either is empty. It wraps the compatible client with name `Dashu Managed AI`, mode `managed`, base URL `${cloudUrl}/api/ai/v1`, and model default `dashu-sql`. Timeout inherits 60 seconds when omitted.

Planning prompts—question, filtered schema, history, approved semantic vocabulary, and repair errors when applicable—cross the Dashu Cloud boundary. Database credentials, result rows, and host cookies do not pass through this provider.

## `@rophpad/dashu-next`

Source: [`packages/adapter-next/src/index.ts`](../../packages/adapter-next/src/index.ts)

Uses the standard `Request`/`Response` APIs and is intended for server route modules. All responses have `Content-Type: application/json`.

```ts
type DashuRouteOptions = {
  getActor: (request: Request) => Promise<DashuActor | null> | DashuActor | null;
  selectDataSource?: (context: { actor: DashuActor; request: Request }) =>
    Promise<string | undefined> | string | undefined;
  getPolicy?: (context: { actor: DashuActor; request: Request }) =>
    Promise<DashuPolicyInput | undefined> | DashuPolicyInput | undefined;
  getSemanticLayer?: (context: { actor: DashuActor; dataSource?: string }) =>
    Promise<SemanticLayer | undefined> | SemanticLayer | undefined;
  onAnswer?: (context: {
    actor: DashuActor;
    question: string;
    result: Awaited<ReturnType<Dashu["ask"]>>;
  }) => Promise<void> | void;
};
```

`getActor` is required and is the authorization boundary. `null` yields `FORBIDDEN`/403. Trusted actor, data-source, policy, and semantic values come from callbacks, never the body.

### `dashuRoute(dashu, options)`

Returns a `POST(request)` handler. Body shape is `{ question, history? }`; only a string question is used. History keeps valid `{question:string, sql:string}` objects and the last six entries. It passes `request.signal` through. `onAnswer` runs after either answered or unanswerable success; if it throws, the route returns an error even though the Dashu request completed. Success is the raw `AskResult` with HTTP 200.

```ts
// app/api/dashu/ask/route.ts
export const POST = dashuRoute(dashu, {
  getActor: async (request) => actorFromSession(request),
  selectDataSource: ({ actor }) => actor.tenantId,
});
```

### `dashuRunRoute(dashu, options)`

Returns a `POST` handler for `{ sql }`. Non-string SQL becomes `""` and core returns `INVALID_REQUEST`. It resolves actor/source/policy, but does not use semantic layer or call `onAnswer`. Success is `AskResult` with HTTP 200.

### `dashuSchemaRoute(dashu, options)`

Returns a `GET` handler. Query `?refresh=1` sets `force: true`; other values do not. Success is `{ version: "1", schema }` with HTTP 200. Semantic layer and `onAnswer` are unused.

Malformed JSON becomes `INVALID_REQUEST`. Structured errors use the mappings in [Errors](./errors.md). `detail` is logged server-side when present; unknown errors are logged and redacted. Errors without a core request ID use `req_unknown`.

## `@rophpad/dashu-react`

Source: [`packages/react/src/index.ts`](../../packages/react/src/index.ts)

Requires peer `react >=18`. The entire entry is built with a `"use client"` directive, so it is a client module in React/Next.js. Components use inline styles, SVG, browser fetch, and CSS custom properties; no stylesheet or chart dependency is required.

### `useDashu(options?)`

```ts
type UseDashuOptions = {
  endpoint?: string;
  keepHistory?: boolean;
  headers?: Record<string, string>;
  onResult?: (result: AskResult) => void;
  onError?: (error: DashuErrorPayload) => void;
};
type DashuErrorPayload = { code: string; message: string; requestId?: string };
type UseDashu = {
  ask(question: string): Promise<AskResult | null>;
  retry(): Promise<AskResult | null>;
  cancel(): void;
  reset(): void;
  result: AskResult | null;
  error: DashuErrorPayload | null;
  loading: boolean;
  question: string;
  history: AskTurn[];
};
```

Defaults: endpoint `/api/dashu/ask`, history enabled. `ask` trims input and returns `null` for empty input, HTTP/network errors, or cancellation. Starting a new ask aborts the previous request. Headers are `{ "Content-Type": "application/json", ...headers }`, so custom values may override content type.

Successful payloads are cast to `AskResult` without runtime validation. History is added only for answered results carrying `query.sql`, is capped at six turns, and is sent on later asks. Thus follow-ups require server policy to expose SQL. `retry` reuses the last non-empty question; `cancel` aborts and clears loading but preserves result/error/history; `reset` also clears all state. Abort is silent. Non-JSON/non-Dashu failures become `{code:"INTERNAL", message:"Something went wrong. Please try again."}`.

### `DashuComposer(props)`

```ts
type DashuComposerProps = {
  onSubmit(question: string): void;
  onCancel?: () => void;
  loading?: boolean;
  placeholder?: string;
  suggestions?: string[];
  autoFocus?: boolean;
  className?: string;
};
```

Defaults: `loading: false`, placeholder `Ask a question about your data…`, no suggestions. Form submission trims input, ignores empty/loading submissions, calls `onSubmit`, then clears input. While loading, the input is disabled; a Stop button appears only when `onCancel` exists. Clicking a suggestion calls `onSubmit` directly and does not copy it into the input.

### `DashuResult(props)`

```ts
type RenderProps = { data: ResultData; spec: DisplaySpec };
type DashuComponents = {
  Table?: (props: RenderProps) => ReactNode;
  Metric?: (props: RenderProps) => ReactNode;
  BarChart?: (props: RenderProps) => ReactNode;
  LineChart?: (props: RenderProps) => ReactNode;
  AreaChart?: (props: RenderProps) => ReactNode;
  PieChart?: (props: RenderProps) => ReactNode;
  ScatterChart?: (props: RenderProps) => ReactNode;
};
type DashuResultProps = {
  result: AskResult;
  components?: DashuComponents;
  allowSwitching?: boolean;
  showSql?: boolean;
  className?: string;
};
```

Defaults: built-in components, switching enabled, SQL hidden. Unanswerable results render only answer text. Answered results render answer text, primary display, and a type switcher when alternatives exist. Overrides are called as functions, not instantiated with JSX. Area charts use the built-in `LineChart` with `filled` when no override exists. SQL appears only when `showSql` is true *and* the server included `result.query`.

### Built-in components

- `Table({data, maxHeight?})`, with `maxHeight` default `420`, sticky headers, text-only cells, numeric alignment, and a conservative truncation notice. Returns `null` with no columns.
- `Metric({data, spec})` reads `spec.y` or the first column from the first row, accepts finite numbers/numeric strings, abbreviates display, and returns `null` when unavailable.
- `BarChart({points})` renders horizontal bars. Negative values do not produce meaningful bar widths because scale maximum is clamped through zero; use an override if negative bars matter.
- `LineChart({points, filled?})` renders line or area SVG. It assumes a non-empty point list supplied by a validated display.
- `PieChart({points})` sorts descending, collapses more than eight slices into `Other`, and returns `null` when total is non-positive.
- `ScatterChart({points, xLabel?, yLabel?})` renders numeric x/y points and assumes non-empty validated points.

The chart prop object types are inferred from function signatures and are not separately named exports.

### Data/export helpers

```ts
type Point = { label: string; value: number; xValue: number | null };
```

- `toNumber(cell)` accepts finite numbers and non-empty numeric strings after removing commas; booleans/null return `null`. Precision can be lost when PostgreSQL numeric/bigint strings exceed JavaScript number precision.
- `toLabel(cell)` maps null to `—`, strips the time from ISO timestamps matching `YYYY-MM-DDT...`, otherwise stringifies.
- `formatValue(number)` uses `B` at 1e9, `M` at 1e6, `K` at 10,000, locale formatting for integers, otherwise two decimals.
- `formatCell(cell)` maps null to `—`, booleans to lowercase text, otherwise stringifies.
- `toPoints(data, spec)` requires both axes, drops nonnumeric y rows, computes numeric x when possible, and returns at most the first 30 points.
- `columnLabel(data, key)` resolves a result label, falls back to the key, or returns `""` for no key.
- `toCsv(data)` writes labels and rows in column order with CRLF lines, RFC-style quote doubling, and empty fields for null/undefined. It does not enforce `capabilities.export`; callers must check that flag before exposing export UI. It also does not mitigate spreadsheet formula injection.

### Theme helpers

`token` exposes inline-style values for `fg`, `muted`, `faint`, `border`, `surface`, `panel`, `accent`, `radius`, `font`, and `mono`. Each reads a `--dashu-*` variable, then a legacy `--askdb-*` variable, then a built-in fallback.

`seriesColor(index)` cycles eight `--dashu-s1` … `--dashu-s8` (with legacy/fixed-color fallbacks). Negative indices are not supported.

The package re-exports these core types for renderer users: `AskResult`, `AskAnswered`, `AskUnanswerable`, `Cell`, `DisplayPlan`, `DisplaySpec`, `DisplayType`, `ResultColumn`, and `ResultData`.
