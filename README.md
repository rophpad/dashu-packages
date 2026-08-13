![Dashu](cloud/public/logo.png)

# Dashu

**Talk to your database.** Dashu adds administrator-only, natural-language analytics to a
product you already have. An administrator asks a question in plain English and gets typed
rows, a chart, and — if your policy allows it — the SQL that produced them.

It ships as npm packages that run inside **your** backend. Your connection string never
leaves your infrastructure, and query results never leave it either.

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres @rophpad/dashu-next @rophpad/dashu-react
```

This one document covers both sides: [using Dashu](#part-1--using-dashu) in your product,
and [working on Dashu](#part-2--working-on-dashu) itself.

---

## Contents

**Part 1 — Using Dashu**
- [How a question flows](#how-a-question-flows)
- [1. Configure the server](#1-configure-the-server)
- [2. Mount an authorized route](#2-mount-an-authorized-route)
- [3. Render the result](#3-render-the-result)
- [Choosing an AI provider](#choosing-an-ai-provider)
- [Managed AI: account, plan, credential](#managed-ai-account-plan-credential)
- [Permissions and policy](#permissions-and-policy)
- [The result contract](#the-result-contract)
- [Errors](#errors)
- [Security model](#security-model)
- [What Dashu does not do](#what-dashu-does-not-do)

**Part 2 — Working on Dashu**
- [Repository layout](#repository-layout)
- [How the packages compose](#how-the-packages-compose)
- [Inside each package](#inside-each-package)
- [Inside cloud/](#inside-cloud)
- [Build system](#build-system)
- [Local development](#local-development)
- [Publishing](#publishing)
- [Adding a database adapter](#adding-a-database-adapter)
- [Known gaps](#known-gaps)

---

# Part 1 — Using Dashu

## How a question flows

```
admin browser
  → your API route          ← you authorize here
  → dashu core              ← policy, filtered schema
  → AI provider             ← planning only: question + schema
  → dashu core              ← validates the generated SQL
  → your database           ← read-only execution, in your network
  → typed rows + display plan
  → your UI
```

Two properties are worth stating plainly, because they are what makes this safe to put in
an admin area:

- **The AI provider never sees your data.** It receives the question and the filtered
  schema, and returns a query plan. Rows are fetched afterwards, by your backend.
- **The browser never talks to the database or the model.** It talks to your route, which
  decides who the caller is and what they may see.

## 1. Configure the server

Create one instance on the server. Point it at a **dedicated read-only role** — not the
credential your application uses for normal work.

```ts
// lib/dashu.ts
import { createDashu } from "@rophpad/dashu-core";
import { postgresAdapter } from "@rophpad/dashu-database-postgres";
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

export const dashu = createDashu({
  ai: openRouterProvider({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: "openai/gpt-4.1-mini",
  }),

  dataSources: {
    analytics: postgresAdapter({
      connectionString: process.env.DASHU_DATABASE_URL!,
      schemas: ["analytics"],
    }),
  },
  defaultDataSource: "analytics",

  defaults: {
    maxRows: 200,
    statementTimeoutMs: 10_000,
    exposeSql: false,
    allowExport: false,
    allowSaveDashboard: false,
    denyTables: ["analytics.payment_tokens"],
    denyColumns: ["analytics.customers.email"],
  },

  // Metadata only — no question, SQL or rows.
  onEvent: (event) => metrics.record(event),
});
```

`createDashu` returns:

| Method | Purpose |
|---|---|
| `ask({ question, actor, … })` | Plan, validate, execute, return a result |
| `run({ sql, actor, … })` | Re-run stored SQL — a saved dashboard card, no model call |
| `schema({ actor, … })` | The approved schema, for a schema browser |
| `testConnection(dataSource?)` | Pre-flight check |
| `dataSourceNames()` | Configured source keys |

Every call takes an explicit actor, data source and policy. Nothing reads global state, so
two concurrent requests can never share a tenant, policy or connection.

### `postgresAdapter` options

| Option | Default | Notes |
|---|---|---|
| `connectionString` | — | Required. Use a read-only role. |
| `schemas` | `["public"]` | Which schemas to introspect |
| `schemaTtlMs` | `60000` | How long a catalog read is reused |
| `poolMax` | `8` | Pool size |
| `connectionTimeoutMs` | `10000` | |
| `ipFamily` | `"4"` | `"4"`, `"6"` or `"auto"` — Docker bridges often have no IPv6 route |

## 2. Mount an authorized route

`getActor` is the gate. Return `null` and the route answers 403 without explaining why.

```ts
// app/api/dashu/ask/route.ts
import { dashuRoute } from "@rophpad/dashu-next";
import { dashu } from "@/lib/dashu";
import { requireCurrentUser } from "@/lib/auth";

export const POST = dashuRoute(dashu, {
  getActor: async (request) => {
    const user = await requireCurrentUser(request);
    if (!user.permissions.includes("dashu:ask")) return null;

    return { id: user.id, tenantId: user.tenantId, permissions: user.permissions };
  },

  selectDataSource: ({ actor }) => dataSourceForTenant(actor.tenantId),

  // Persist what you want to keep. Dashu stores nothing itself.
  onAnswer: async ({ actor, question, result }) => {
    await history.create({ adminId: actor.id, question, sql: result.query?.sql });
  },
});
```

Also available: `dashuRunRoute` (replay saved SQL) and `dashuSchemaRoute` (schema browser).
`DashuRouteOptions` additionally accepts `getPolicy` and `getSemanticLayer`.

> **Hiding a page in the frontend is not authorization.** `{user.isAdmin && <Analytics />}`
> improves navigation; it does not stop a direct `POST`. The route is the boundary.

The adapters are a convenience. The canonical API is `dashu.ask()` — call it from Express,
Fastify, NestJS, Hono or a plain handler, passing the same explicit arguments.

## 3. Render the result

`useDashu` owns the fetch, loading flag, cancellation, retry and follow-up history.

```tsx
"use client";
import { useDashu, DashuComposer, DashuResult } from "@rophpad/dashu-react";

export function Analytics() {
  const { ask, cancel, result, error, loading } = useDashu({
    endpoint: "/api/dashu/ask",
  });

  return (
    <>
      <DashuComposer
        onSubmit={ask}
        onCancel={cancel}
        loading={loading}
        suggestions={["Revenue by country", "New signups per month"]}
      />
      {error && <p role="alert">{error.message}</p>}
      {result && <DashuResult result={result} showSql={result.capabilities?.showSql} />}
    </>
  );
}
```

### Using your own components

Anything you pass overrides the built-in renderer; anything you omit falls back to it.

```tsx
<DashuResult
  result={result}
  components={{ Table: ProductTable, BarChart: ProductBarChart }}
/>
```

Or ignore `@rophpad/dashu-react` entirely and switch on the contract yourself:

```tsx
switch (result.display.primary.type) {
  case "bar-chart":
    return <ProductBarChart data={result.data} spec={result.display.primary} />;
  case "table":
    return <ProductTable data={result.data} />;
}
```

### Theming

No stylesheet ships. Components read CSS custom properties with fallbacks, so they render
standalone and inherit your palette when these are defined on any ancestor:

```css
--dashu-accent   --dashu-fg       --dashu-muted    --dashu-faint
--dashu-border   --dashu-surface  --dashu-panel    --dashu-radius
--dashu-font     --dashu-font-mono
--dashu-s1 … --dashu-s8          /* categorical series colours */
```

Also exported: `Table`, `Metric`, `BarChart`, `LineChart`, `PieChart`, `ScatterChart`,
`toCsv`, `toPoints`, `formatValue`, `token`, `seriesColor`.

## Choosing an AI provider

Database and provider are independent — any adapter works with any provider.

```ts
// 1. Your own OpenRouter key. Never reaches this project's servers.
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";
const ai = openRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY!, model: "openai/gpt-4.1-mini" });

// 2. A model you run. Nothing leaves your network.
import { openAiCompatibleProvider } from "@rophpad/dashu-provider-openai-compatible";
const ai = openAiCompatibleProvider({
  name: "Internal model",
  baseUrl: "http://ollama:11434/v1",
  model: "qwen2.5-coder:7b",
});

// 3. Managed AI. Needs a plan and a credential — see below.
import { managedProvider } from "@rophpad/dashu-provider-managed";
const ai = managedProvider({
  cloudUrl: process.env.DASHU_CLOUD_URL!,
  credential: process.env.DASHU_INSTALLATION_CREDENTIAL!,
});
```

Any OpenAI-compatible server works with the third package: Ollama, vLLM, LocalAI,
llama.cpp, or an internal gateway.

## Managed AI: account, plan, credential

**Only** `managedProvider` involves the Dashu platform. The other two modes never contact
it, and work without an account.

1. Create an account and buy a plan.
2. On your account page, create a **Managed AI credential**. It is displayed once — only a
   SHA-256 hash is stored, so a lost credential is rotated, not recovered.
3. Put it in your **backend** environment:

```bash
DASHU_CLOUD_URL=https://dashu.dev
DASHU_INSTALLATION_CREDENTIAL=...
```

Creating a credential with the name of an existing one **rotates** it: the old secret stops
working immediately and the usage history stays attached. Revoking takes effect on the next
request.

> **The credential is a backend secret.** It is sent by `managedProvider`, server-side, as a
> bearer token. It must never be shipped to a browser, put in `NEXT_PUBLIC_*`, or included
> in a client bundle — anyone holding it can spend your quota. Requests to Managed AI
> originate from your server, never from your UI.

What the gateway receives: the question, the filtered schema, and approved semantic
vocabulary. What it never receives: your database credentials, your result rows, your
session cookies, or schemas excluded by policy.

Each request is authenticated against the stored hash, checked for an active plan, and
counted against a monthly quota. Usage metadata is recorded; prompt and response bodies are
not stored.

## Permissions and policy

Map your own roles onto these:

```text
dashu:ask             ask questions
dashu:view-schema     read the approved schema
dashu:view-sql        receive the generated SQL
dashu:export          export result rows
dashu:save-dashboard  save a query
```

`exposeSql`, `allowExport` and `allowSaveDashboard` are derived from the actor's
permissions and **intersected** with your instance defaults — a request can narrow
disclosure, never widen it. The outcome is reported as `capabilities` on the result and
enforced server-side, not merely used to hide buttons.

Policy fields:

| Field | Effect |
|---|---|
| `schemas` | Which schemas may be introspected |
| `denyTables` | Removed from the schema before the model sees it |
| `denyColumns` | Same, per column |
| `maxRows` | Hard cap, injected as a wrapping `LIMIT` |
| `statementTimeoutMs` | Enforced by the database |
| `exposeSql` | Whether `query.sql` is returned |
| `allowExport` / `allowSaveDashboard` | Reported in `capabilities` |

Deny rules are applied to the introspected catalog **before** it is rendered into a prompt,
so a denied table is not merely discouraged — the model never learns it exists.

## The result contract

Versioned, and canonical: `@rophpad/dashu-react` and every host integration read this shape.

```jsonc
{
  "version": "1",
  "answered": true,
  "answer": { "text": "Revenue by country." },
  "data": {
    "columns": [
      { "key": "country", "label": "country", "type": "string" },
      { "key": "revenue", "label": "revenue", "type": "number" }
    ],
    "rows": [{ "country": "GB", "revenue": "1150.25" }],
    "truncated": false
  },
  "display": {
    "primary": { "type": "bar-chart", "title": "Revenue by country", "x": "country", "y": "revenue" },
    "alternatives": [{ "type": "line-chart", "x": "country", "y": "revenue" }, { "type": "table" }]
  },
  "capabilities": { "showSql": true, "export": false, "saveDashboard": true },
  "meta": { "requestId": "req_…", "rowCount": 3, "durationMs": 91 },
  "query": { "dialect": "postgresql", "sql": "SELECT …" }
}
```

Things that will bite you if you assume otherwise:

- **Column keys are deduplicated.** `SELECT u.name, c.name` yields `name` and `name_2`. A
  join never silently reports one value twice.
- **Numerics arrive as strings.** `Number()` on a wide `numeric` loses precision, so the
  driver's string is preserved. Parse at the point of display.
- **`query` is absent unless policy allowed it.** Never assume `result.query.sql` exists.
- **`display` is validated against the rows that came back.** Referenced columns must
  exist and measures must be numeric, or the plan falls back to a table. It is always a
  declarative spec — never HTML, JSX or JavaScript.

Display types: `table`, `metric`, `bar-chart`, `line-chart`, `area-chart`, `pie-chart`,
`scatter-chart`.

When the approved schema cannot answer the question, `answered` is `false` with an
explanation. That is an outcome, not an error.

## Errors

```json
{ "error": { "code": "QUERY_NOT_ALLOWED", "message": "…", "requestId": "req_…" } }
```

```text
UNAUTHORIZED   FORBIDDEN   INVALID_REQUEST   AI_NOT_CONFIGURED   AI_UNAVAILABLE
DATA_SOURCE_NOT_CONFIGURED   SCHEMA_UNAVAILABLE   QUERY_NOT_ALLOWED
QUERY_TIMEOUT   QUERY_FAILED   RESULT_LIMIT_EXCEEDED   CANCELLED   INTERNAL
```

`DashuError` carries a safe `message` and a server-only `detail`. The driver text, provider
payload and connection information live in `detail`, are logged, and are never serialised
into a response — they are also what lets the model repair a failed query on its one retry.

## Security model

Authorization is enforced outside the model, in this order of authority:

1. **Database grants.** Point the adapter at a role with `SELECT` on approved views only.
   This is the boundary that matters.
2. **Read-only transaction.** Every statement runs inside `BEGIN TRANSACTION READ ONLY`
   with a statement timeout, so a write is rejected by PostgreSQL even if everything above
   it failed.
3. **Schema policy.** Deny rules are applied before the prompt is built.
4. **The SQL guard.** Rejects writes, DDL, data-modifying CTEs, multiple statements,
   `SELECT … INTO`, and filesystem or network functions; wraps the query in a hard row
   limit.

Prompt instructions are not on this list. They are not a control.

Prefer exposing purpose-built views over raw tables:

```sql
CREATE SCHEMA analytics;
CREATE VIEW analytics.customer_activity AS
  SELECT customer_id, country, plan, created_at FROM private.customers;
```

For multi-tenancy, take the tenant from the session and enforce isolation with a
per-tenant connection, a per-tenant schema, or row-level security. Never rely on the model
to add `WHERE tenant_id = …`.

Stored SQL is re-validated on every replay under the **current** policy. A saved dashboard
is stored data; it does not stay authorized because someone saved it once.

## What Dashu does not do

By design, these belong to your product:

- **Persistence.** Questions, SQL, dashboards and history are yours to store. Result rows
  are ephemeral. `onAnswer` is the hook.
- **Authentication and roles.** Dashu consumes an actor; it never establishes one.
- **Secret storage.** Provider keys and connection strings come from your environment or
  secret manager.

Currently implemented: **PostgreSQL**, and a **Next.js** route adapter. Other dialects need
a deliberate adapter — see below.

---

# Part 2 — Working on Dashu

## Repository layout

```
packages/          the SDK — seven npm packages, one workspace
cloud/             the hosted platform: accounts, plans, Managed AI gateway
tsconfig.packages.json   shared compiler options for the packages
```

`cloud/` is **not** a workspace member. It has its own lockfile and dependencies and is
deployed separately. The two connect only over HTTP, and only when a customer chooses
Managed AI.

## How the packages compose

```
                    ┌──────────────────────────┐
                    │  @rophpad/dashu-core     │  contract + pipeline
                    └────────────┬─────────────┘
         ┌───────────────┬───────┴────────┬──────────────────┐
         │               │                │                  │
   database-postgres    next            react       provider-openai-compatible
                                                             │
                                                    ┌────────┴────────┐
                                            provider-managed   provider-openrouter
```

`core` depends on nothing. Everything else depends on `core` and on nothing else, except
the two concrete providers, which wrap `provider-openai-compatible` because Managed AI and
OpenRouter both speak the OpenAI chat-completions format.

The dependency direction is the architecture: `core` defines `DashuAiProvider` and
`DashuDatabaseAdapter` as interfaces and never imports an implementation, so a provider or
dialect can be added without touching it.

## Inside each package

### `@rophpad/dashu-core`

| File | Contains |
|---|---|
| `types.ts` | Every public type: actor, policy, schema, result contract, the two adapter interfaces |
| `ask.ts` | `createDashu` — orchestrates plan → validate → execute → shape, plus the one repair retry |
| `policy.ts` | Merging defaults with request policy, deriving capabilities, applying deny rules |
| `planning.ts` | Prompt assembly and plan parsing. The only place that talks to a provider |
| `display-spec.ts` | Validates a proposed display against the rows that came back |
| `result.ts` | Positional rows → typed object rows, with key deduplication |
| `errors.ts` | `DashuError`, codes, and the safe/detail split |
| `json.ts` | Extracting a JSON object from a model reply that may be fenced or wrapped in prose |

### `@rophpad/dashu-database-postgres`

| File | Contains |
|---|---|
| `index.ts` | Pooling, read-only execution, `testConnection`, cache invalidation |
| `introspect.ts` | Catalog queries: tables, columns, enums, comments, foreign keys — and prompt rendering |
| `guard.ts` | The SQL validator: tokenises with strings and comments stripped, then rejects |

`guard.ts` is the file to read carefully before changing. It deliberately rejects write
keywords only in *statement position*, because an earlier version rejected
`SELECT count(comment) FROM posts` — `comment` is also a DDL keyword.

### `@rophpad/dashu-next`

One file. `dashuRoute`, `dashuRunRoute`, `dashuSchemaRoute` — thin wrappers that parse a
body, call `getActor`, and map `DashuError` onto status codes.

### `@rophpad/dashu-react`

| File | Contains |
|---|---|
| `use-dashu.ts` | The hook: fetch, cancel, retry, follow-up history |
| `dashu-result.tsx` | Display switcher and component overrides |
| `dashu-composer.tsx` | Question input |
| `Table.tsx`, `Metric.tsx`, `charts/*` | Built-in renderers, hand-rolled SVG |
| `data.ts` | Coercion from contract rows to plottable points |
| `theme.ts` | CSS-variable tokens |
| `export.ts` | `toCsv` |

### Provider packages

`provider-openai-compatible` holds the real client: retries, timeout, error redaction, and
the `max_tokens` / `max_completion_tokens` fallback for servers that reject one of them.
`provider-managed` and `provider-openrouter` are thin configurations over it.

## Inside `cloud/`

A Next.js App Router app with Prisma and Better Auth.

```
src/app/
  page.tsx  pricing/  signin/  signup/  checkout/  docs/  account/
  api/
    auth/[...all]          Better Auth
    checkout               mocked payment → writes the paid Order
    account                purchase history and current entitlement
    installations          Managed AI credentials: list, create/rotate, revoke
    ai/v1/chat/completions the Managed AI gateway
    ai/complete            deprecated, returns a pointer to the above
src/components/            AccountView, ManagedAiPanel, InstallPanel, Checkout, …
src/lib/
  auth.ts        sessions, currentAccount()
  config.ts      environment
  instances.ts   credential issue/resolve, entitlement, quota, usage
  plans.ts       the plan catalogue — `monthlyRequests` is the quota
  plans.ts       plan catalogue
  store.ts       order queries
  prisma.ts      client singleton
prisma/schema.prisma       User, Session, Account, Verification,
                           Order, Installation, AiUsage
```

Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL. A pooled Neon URL works. |
| `BETTER_AUTH_SECRET` | Session signing |
| `BETTER_AUTH_URL` | Public origin |
| `IMOLE_API_KEY`, `IMOLE_BASE_URL` | Upstream model for the gateway |
| `DASHU_MANAGED_AI_MODEL` | Model the gateway routes to |
| `DASHU_MANAGED_AI_MONTHLY_REQUESTS` | Quota per installation |
| `CLOUD_LICENCE_DAYS`, `CLOUD_PROXY_TIMEOUT_MS` | |

```bash
cd cloud
cp .env.example .env
npm ci
npm run db:migrate
npm run dev
```

An order **is** the entitlement: `entitlementFor` reads the most recent paid, unexpired
one to decide whether Managed AI is unlocked and what the monthly quota is. There is no
licence key to issue or verify, and no signing key to generate.

Quota is counted **per account**, not per credential. Credentials are self-service, so a
per-credential limit would multiply by however many an account created.

## Build system

Each package builds with **tsup**: ESM + CJS + `.d.ts`, sourcemaps, `clean` on.

```jsonc
{
  "main":   "./dist/index.cjs",
  "module": "./dist/index.js",
  "types":  "./dist/index.d.ts",
  "exports": { ".": { "types": …, "import": …, "require": … } },
  "files": ["dist", "README.md"]
}
```

Two details that are load-bearing:

- **`@rophpad/dashu-react` sets `treeshake: false`** and injects `"use client"` via a
  banner. Rollup's treeshake pass strips module-level directives and only *warns*; without
  this the client boundary silently disappears and every App Router consumer breaks.
- **Relative imports carry no extension.** TypeScript's `bundler` resolution and every
  bundler accept that; `.js` specifiers pointing at `.ts` files do not survive webpack.

## Local development

```bash
npm install          # links the workspace
npm run build        # every package, in dependency order
npm run typecheck    # builds first, so cross-package types resolve
npm run clean
```

`npm run typecheck` builds because packages consume each other through `dist`. Editing
`core` and typechecking `react` without rebuilding checks the *previous* `core`.

For a tight loop, run `npm run dev` (tsup `--watch`) in the package you are editing.

### Tests

```bash
npm test --workspaces --if-present
```

`@rophpad/dashu-react` renders against its **built output**, so `npm run build` runs first.
The suite therefore exercises the bundle a consumer installs, not the source — which is
where a stripped `"use client"` or a broken `exports` map would show up.

To exercise the core pipeline, run a throwaway PostgreSQL, seed it, and drive `createDashu`
with a stub provider returning a fixed plan. That covers introspection, deny rules, the
guard, execution, result shaping and display validation without spending tokens.

> **When testing `cloud/`, do not rely on shell environment variables.** `cloud/.env` takes
> precedence over exported variables, so a shell `DATABASE_URL` is ignored and writes land
> in whatever `.env` points at. Use `cloud/.env.local`, which Next.js loads at higher
> precedence, and delete it afterwards.

## Publishing

The packages are published publicly under the `@rophpad` npm scope. Authenticate with an
npm account that has permission to publish to that scope before the first release:

```bash
npm login
npm whoami
```

When interactive login is unavailable, configure an npm access token instead:

```bash
npm config set //registry.npmjs.org/:_authToken=npm_your_token_here
npm whoami
```

The command writes the token to the user's npm configuration. Never commit an auth token or
place a real token in this repository. For CI, store it as a secret named `NPM_TOKEN` and use
a temporary or user-level `.npmrc` containing:

```ini
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

The token must have permission to publish packages under the `@rophpad` scope. Revoke it
immediately if it is exposed. Remove locally configured authentication when it is no longer
needed with:

```bash
npm config delete //registry.npmjs.org/:_authToken
```

Validate and preview the release without publishing anything:

```bash
npm run build
npm run typecheck
npm test
npm publish --workspaces --access public --dry-run
```

Then publish every workspace package:

```bash
npm publish --workspaces --access public
```

npm package versions are immutable. If a package is already published at `0.1.0`, running
the publish command again produces `E403: You cannot publish over the previously published
versions`. This does not normally indicate a permissions problem: increment the package
versions and publish a new release instead.

```bash
npm version patch --workspaces # 0.1.0 -> 0.1.1
```

Use `minor` or `major` instead of `patch` when appropriate. Because workspace packages use
exact versions for internal dependencies, inspect the resulting changes and ensure references
such as `@rophpad/dashu-core` were also updated to the new version:

```bash
git diff -- packages package-lock.json
```

After confirming the versions, validate and publish:

```bash
npm run build
npm run typecheck
npm test
npm publish --workspaces --access public
```

Do not unpublish a release merely to reuse its version. Consumers may already depend on it,
and npm may prevent that version from being republished. To inspect the live version before
publishing, use `npm view @rophpad/dashu-core version` (and repeat for the other packages).

Each package's `prepack` rebuilds it, so a publish or `npm pack` always ships fresh output.
Before a breaking change, remember that the result contract is versioned (`version: "1"`)
and is what every integration reads.

To confirm a package is genuinely installable, `npm pack` it and install the tarball into a
project **outside** this workspace. Building inside the monorepo proves nothing about how
npm resolution behaves for a consumer.

## Adding a database adapter

Implement `DashuDatabaseAdapter` from `core/src/types.ts`:

```ts
{
  dialect: string;
  promptRules(): string;                    // dialect-specific instructions
  renderSchema(schema: DatabaseSchema): string;
  introspect(policy): Promise<DatabaseSchema>;
  validate(sql, policy): ValidatedQuery;    // must reject writes
  execute(query, options): Promise<QueryResult>;
  testConnection(): Promise<void>;
}
```

`promptRules` and `renderSchema` live on the adapter because identifier quoting and date
functions differ per dialect — `date_trunc` in PostgreSQL, `DATE_FORMAT` in MySQL,
`DATEFROMPARTS` in SQL Server. The model must be told the right ones, and the validator
must understand the same dialect.

Every adapter needs tests proving it rejects writes, DDL and multiple statements; enforces
schema, row and timeout limits; and leaks no connection secrets in errors. Do not advertise
a dialect before those exist.

## Known gaps

Honest status, so nobody discovers these the hard way:

- **The core pipeline has no committed tests.** `@rophpad/dashu-react` has 16
  (`npm test --workspace @rophpad/dashu-react`), covering every display type, the data
  shapes that break naive chart geometry, escaping, and SQL disclosure. The core pipeline
  has been verified against a live PostgreSQL — introspection, deny rules, six guard
  rejections, row limits, disclosure by permission, the repair retry, statement timeout,
  and a write blocked by the read-only transaction with the guard deliberately bypassed —
  but only as a throwaway harness. Turning that into a committed suite is the most
  valuable next contribution, and it needs a disposable database to run against.
- **Checkout is mocked.** No payment processor is connected and every screen says so.
  Wiring one up means replacing the payment step in `cloud/src/app/api/checkout/route.ts`.
- **One dialect, one framework adapter.** PostgreSQL and Next.js.

---

## Licence

Dashu is licensed under the [Apache License 2.0](LICENSE).
