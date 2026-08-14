# Security model

Dashu turns natural-language questions into SQL, so treat every generated statement as untrusted input. The design is defense in depth: the model receives a minimized catalog, generated SQL is checked and capped, PostgreSQL executes it in a read-only transaction, and the database role remains the final authority.

This document describes what the packages in this repository enforce and what the host application must enforce. For tenant-specific deployment patterns, see [Authorization, policy, and multitenancy](../guides/authorization-policy-multitenancy.md).

## Trust boundaries

| Value | Source | Trust decision |
|---|---|---|
| `actor` and `actor.permissions` | Host callback `getActor` | Trusted only if derived server-side from an authenticated session or token |
| `actor.tenantId` | Host authentication data | Routing context only; setting it does not filter rows |
| Data-source key | Server callback `selectDataSource` | Must be selected from the configured `dataSources`; never accept a connection string from the client |
| Request policy | Server callback `getPolicy` | Trusted authorization input; do not copy arbitrary body/query values into it |
| Semantic layer | Server callback `getSemanticLayer` | Trusted prompt input; it is sent to the provider |
| Question and history | Request body | Untrusted prompt input |
| Model response and SQL | AI provider | Untrusted; validate before execution |
| Database grants/RLS | PostgreSQL | Authoritative data-access boundary |
| Display suggestion | Model response | Declarative data only; mapped to trusted UI components, not executed as HTML or JavaScript |

`@rophpad/dashu-next` reads `question` and `history` from JSON, but obtains actor, data source, policy, and semantic data through server callbacks. Core also requires `dashu:ask` before planning or running SQL. The legacy `askdb:*` permission names are accepted as aliases by `policy.ts`.

Do not construct a `DashuActor` from fields such as `userId`, `tenantId`, or `permissions` supplied by the browser.

## End-to-end data flow

For `dashuRoute`, the implemented path is:

1. `getActor(request)` authenticates the request and returns a server-derived actor. Returning `null` produces `FORBIDDEN`.
2. The adapter parses JSON. `question` is accepted only if it is a string. History entries must have string `question` and `sql` fields; malformed entries are discarded and only the last six are retained.
3. `selectDataSource`, `getPolicy`, and `getSemanticLayer` run on the server. The selected source is a key into the adapters configured in `createDashu`, not a client-selected connection string.
4. Core requires `dashu:ask`, trims the current question, rejects an empty question and questions over 2,000 characters, and resolves policy.
5. The PostgreSQL adapter introspects the selected schemas. The schema cache key includes both the connection string and sorted schema list. Core then removes denied tables, denied columns, and relationships to hidden tables.
6. Core renders the filtered catalog and constructs the provider messages.
7. The provider returns a JSON query plan. Core extracts bounded SQL, explanation, and declarative display fields.
8. The database adapter validates SQL, wraps it in a row limit, and executes it inside a PostgreSQL read-only transaction with a local statement timeout.
9. Core converts positional database rows into JSON-safe result rows and validates the display plan against the returned columns.
10. The route calls `onAnswer` only after a successful `ask` result, then serializes the result. Dashu itself persists no questions, SQL, rows, history, or dashboards.

The request's abort signal is passed to the provider and database. The PostgreSQL adapter attempts `pg_cancel_backend` on its own in-flight connection when the caller disconnects, and always rolls the transaction back before releasing the client.

### Exactly what the AI provider receives

The planning request contains:

- fixed planner instructions and PostgreSQL-specific rules;
- the **filtered, rendered schema**, including visible identifiers, types, relationships, enum values, and catalog comments represented by the renderer;
- the approved semantic layer (`terms` and `notes`), if supplied;
- up to six history turns; and
- the current question.

For every history turn, `planning.ts` sends two messages:

```text
user: <previous question>
assistant: Previous query:
<previous SQL>
```

History SQL is context only. It is not executed by `ask`, is not revalidated before being sent, and should therefore be considered untrusted provider input. The Next adapter bounds the number of turns but does not bound each history string's length. Hosts that accept browser history should impose suitable request/body and per-field limits and should not put secrets or row values in history.

The provider does **not** receive the database connection string, database credentials, actor/session object, cookies, or query result rows. Provider credentials are attached by the provider package as backend HTTP authorization and are not included in prompt messages.

With Managed AI, the planning messages travel from the host backend to Dashu Cloud and then to its model provider. With OpenRouter they go directly to OpenRouter. With an OpenAI-compatible endpoint they go to the configured endpoint. Review the chosen service's retention, regional, and training terms: the filtered schema, comments, semantic notes, history SQL, and questions may still be sensitive metadata.

### Repair flow and error disclosure

Repair is intentionally narrow:

1. The first generated SQL passes `adapter.validate` before execution. Validation failures such as multiple statements, a write keyword, `SELECT ... INTO`, or a banned function fail immediately with `QUERY_NOT_ALLOWED`; they are **not** sent back to the model for repair.
2. If execution throws `QUERY_FAILED`, core makes exactly one additional planning call. Timeouts, cancellation, and other `DashuError` codes are not repaired.
3. The repair prompt includes the current question, the first generated SQL, and an error string. For a PostgreSQL execution error this is normally the driver's message stored in `DashuError.detail`. Driver messages can contain schema names, column names, and literal values, so this is additional data disclosed to the configured provider.
4. The corrected SQL is validated again and executed under the same policy, row cap, timeout, transaction, role, and tenant context. There is no third model attempt. A failure while validating or executing the corrected SQL is returned normally.

The original plan's explanation and display suggestion remain the presentation basis even when corrected SQL is executed; the repair changes the SQL execution attempt, not the already-held presentation fields.

`DashuError.detail` is server-only. The Next adapter logs it with the request ID and returns only the safe error code, safe message, and request ID. Unknown exceptions become a generic `INTERNAL` response. Provider errors are reduced to a bounded detail string before logging because a provider can echo prompt content. Protect application logs accordingly; redaction from HTTP is not redaction from logs.

One subtle implementation consequence is that connection failures are represented by the PostgreSQL adapter as `QUERY_FAILED`. Core can therefore make a repair call even when the underlying failure is connectivity rather than SQL syntax. That call still cannot bypass database controls, but operators should account for the extra provider request when diagnosing failed connections.

## Layered database security

No single layer should be treated as sufficient.

1. **Authentication and route authorization.** The host establishes the actor. Core checks `dashu:ask`; schema browsing separately checks `dashu:view-schema`.
2. **Trusted source and tenant routing.** The host maps the actor to a preconfigured adapter. A tenant identifier carried on the actor does nothing by itself.
3. **Prompt minimization.** Only approved schemas are introspected; deny rules remove catalog objects before the provider call. This reduces disclosure and bad plans, but is not a database permission boundary.
4. **SQL guard.** The PostgreSQL guard strips comments/literals for scanning, permits one statement beginning with a read shape, rejects write statements including data-changing CTE bodies, rejects `SELECT ... INTO`, blocks a list of dangerous functions, and wraps the query as:

   ```sql
   SELECT * FROM (
     -- generated SQL
   ) AS dashu_result LIMIT <maxRows>
   ```

   This is a focused guard, not a complete PostgreSQL parser or privilege system.
5. **Read-only transaction and timeout.** Execution uses `BEGIN TRANSACTION READ ONLY` and `SET LOCAL statement_timeout = ...`, then always `ROLLBACK`. PostgreSQL rejects writes in the transaction even if the lexical guard misses one.
6. **Least-privilege role.** `CONNECT`, schema `USAGE`, object `SELECT`, function privileges, RLS, and tenant-specific grants decide what data is actually accessible. These controls also protect against mistakes in policies or future SQL features.
7. **Result disclosure.** SQL text is omitted server-side unless allowed. Result rows themselves are returned to every actor allowed to ask, so database grants/views/RLS must remove sensitive rows and columns before execution.

The row cap limits returned rows, not query work. An aggregate, join, sort, or function can process many rows before producing a small result. Use the statement timeout, workload controls, replicas, and database monitoring to constrain cost.

## Provision a dedicated read-only PostgreSQL role

Use a separate role and credential for Dashu. Do not reuse the application's migration or read/write credential. The following baseline uses a non-login group role so grants can be managed independently from credential rotation.

Run the database/object grants as an owner or appropriately privileged administrator, replacing names and schema lists:

```sql
-- Privilege container: cannot log in and cannot bypass RLS.
CREATE ROLE dashu_reader NOLOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Credential used by the Dashu connection string.
CREATE ROLE dashu_runtime LOGIN PASSWORD 'replace-with-a-secret'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT dashu_reader TO dashu_runtime;

GRANT CONNECT ON DATABASE app_database TO dashu_reader;
GRANT USAGE ON SCHEMA analytics TO dashu_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO dashu_reader;

-- Apply SELECT to tables/views created later by the role that runs this command.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA analytics
  GRANT SELECT ON TABLES TO dashu_reader;

-- Make read-only the default as another layer; the adapter also starts an
-- explicit READ ONLY transaction and sets a per-request local timeout.
ALTER ROLE dashu_runtime IN DATABASE app_database
  SET default_transaction_read_only = on;
ALTER ROLE dashu_runtime IN DATABASE app_database
  SET statement_timeout = '10s';
```

Repeat `USAGE`, `SELECT`, and default-privilege statements for each approved schema. `ALTER DEFAULT PRIVILEGES` affects only future objects created by the named owner, so run it for every object-creating role used by migrations. Ordinary table reads do not require sequence privileges; grant them only if an intentionally exposed view/function needs them.

Harden shared environments further:

```sql
-- Prevent arbitrary users from creating shadow objects in a shared schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- PostgreSQL commonly grants function/procedure execution to PUBLIC.
-- Revoke broadly only after assessing application compatibility, then grant
-- EXECUTE on a small allow-list if approved analytics views require functions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA analytics FROM PUBLIC;
REVOKE EXECUTE ON ALL PROCEDURES IN SCHEMA analytics FROM PUBLIC;
```

Prefer granting `SELECT` on curated analytics views rather than base tables. Never grant superuser, `BYPASSRLS`, broad write privileges, or membership in owner/migration roles. A read-only transaction is not a reason to leave unnecessary function or schema privileges available.

Verify the actual login, not an administrator role:

```sql
SET ROLE dashu_runtime;
SHOW default_transaction_read_only;
SELECT current_user;
SELECT * FROM analytics.safe_view LIMIT 1; -- must succeed
CREATE TABLE public.must_fail (id integer); -- must fail
RESET ROLE;
```

Also test a direct `INSERT` against an otherwise readable table and access to every excluded schema/table; each must fail.

## Policy and capability semantics

The resolved policy combines built-in defaults, `createDashu({ defaults })`, actor permissions, and trusted per-request policy. The built-in defaults are: adapter-default schemas, no deny entries, 200 rows, 10 seconds, and all disclosure flags off. In `ask` and `run`, actor-derived disclosure booleans are spread after instance defaults, so those permission results become the disclosure base for that operation; instance disclosure booleans do not independently override them.

The merge rules are deliberately not uniform:

- `schemas`: a supplied request list replaces the base list. An empty list means the adapter's configured default schemas.
- `denyTables` and `denyColumns`: request entries are appended to base entries, so they can only add denials.
- `maxRows` and `statementTimeoutMs`: supplied positive values replace base values, capped at 10,000 rows and 120,000 ms. A trusted request policy can therefore raise or lower the configured defaults within those ceilings.
- `exposeSql`, `allowExport`, and `allowSaveDashboard`: disclosure is intersected. For `ask`/`run`, the actor's corresponding permission establishes the base value; request policy may turn it off but cannot turn a false base value on.

This is why `getPolicy` must be trusted server logic. It is inaccurate to treat all request-policy fields as narrowing: schema selection and query limits can change in either direction, while disclosure cannot widen and deny lists are additive.

Capabilities also have different enforcement strength:

- `capabilities.showSql` reflects `exposeSql`, and core enforces it by omitting `result.query` when false. This is true server-side disclosure enforcement.
- `capabilities.export` and `capabilities.saveDashboard` are authorization signals for host UI/API code. Dashu does not implement export or persistence endpoints, so these booleans alone cannot prevent a caller from copying already-returned rows or calling a host endpoint. The host must authorize export/save operations again on the server.

Hiding a button is never an authorization boundary. Likewise, row data is already disclosed to an authorized asker regardless of the export flag.

## HTTP controls owned by the host

The Next adapter is intentionally small. It does not implement a login system, CSRF checks, origin checks, request-size limits, or per-user/tenant rate limiting.

### Authentication and authorization

- Authenticate every Dashu route in `getActor`; fail closed if the session/token is absent, expired, disabled, or lacks product access.
- Populate permissions from server-side role/entitlement data. Core requires `dashu:ask` for question and stored-SQL execution, and `dashu:view-schema` for schema browsing.
- Derive tenant and source selection from the authenticated actor. Reject unknown or disabled tenant mappings.
- Reauthorize host-owned save, dashboard, sharing, and export endpoints independently.

### CSRF

If authentication uses cookies, POST routes can be CSRF targets. Before invoking `dashuRoute` or `dashuRunRoute`, apply the host framework's CSRF protection. Common defenses include a validated anti-CSRF token plus strict `Origin`/`Referer` allow-listing. Use `SameSite`, `Secure`, and `HttpOnly` cookie settings as supporting controls, not the only control. Bearer-token APIs should reject browser ambient credentials and use a restrictive CORS policy.

The schema route is a GET and supports `?refresh=1`; it still requires authentication and `dashu:view-schema`. Consider rate-limiting refreshes because they bypass the catalog cache.

### Rate and resource limits

Apply limits before provider/database work, keyed at least by actor and tenant and optionally by IP/data source:

- request body bytes and history string lengths;
- concurrent and per-minute asks;
- stored-SQL runs and forced schema refreshes;
- provider token/cost budget; and
- expensive-query concurrency at the database/pool level.

The OpenAI-compatible provider retries one network failure and selected transient HTTP statuses once, but deliberately does not retry HTTP 429. Managed AI states that its cloud gateway applies quotas/rate limiting; that does not replace host limits protecting your route and database. The local/OpenRouter packages add no application-level quota.

## Operational checklist

- [ ] Dedicated non-superuser, `NOBYPASSRLS` database credential
- [ ] Only approved databases, schemas, views, tables, and functions granted
- [ ] Tenant isolation enforced by database/source routing, schema grants, or RLS
- [ ] `getActor`, `selectDataSource`, `getPolicy`, and semantics derived server-side
- [ ] CSRF/origin/CORS controls appropriate to the authentication mechanism
- [ ] Per-actor and per-tenant request, concurrency, history, and refresh limits
- [ ] Provider data-processing terms reviewed for schema/history/error metadata
- [ ] Logs protected because server-only error detail may contain identifiers or values
- [ ] Export/save endpoints reauthorize capabilities server-side
- [ ] Negative isolation and write tests run with the exact Dashu login

## Source references

The behavior above is grounded in:

- `packages/adapter-next/src/index.ts` — route trust split, history parsing, actor resolution, error logging
- `packages/core/src/ask.ts` — permissions, policy resolution, schema filtering, repair, capabilities, error events
- `packages/core/src/planning.ts` — exact provider message assembly and repair prompt
- `packages/core/src/policy.ts` — merge semantics, permission aliases, schema filtering
- `packages/core/src/errors.ts` — safe response/server-detail split
- `packages/database-postgres/src/guard.ts` — SQL checks and row-limit wrapper
- `packages/database-postgres/src/index.ts` — schema cache, read-only transactions, timeout, cancellation, and driver errors
- `packages/provider-openai-compatible/src/index.ts` — provider request, timeout, retries, and bounded errors
- `packages/provider-managed/src/index.ts` and `packages/provider-openrouter/src/index.ts` — provider routing boundaries
