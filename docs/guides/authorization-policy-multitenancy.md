# Authorization, policy, and multitenancy

Dashu carries authenticated identity and tenant context, but it does not invent or enforce a tenant predicate. `actor.tenantId` is metadata used by host callbacks and telemetry; core never appends `WHERE tenant_id = ...`. Enforce isolation before generated SQL reaches data by choosing one of these database patterns:

1. database (or data source) per tenant;
2. schema per tenant; or
3. shared tables protected by PostgreSQL row-level security (RLS).

Do not ask the model to remember a tenant filter. Prompt instructions, semantic notes, and generated predicates are not authorization boundaries.

## Authorize the route first

With `@rophpad/dashu-next`, all trusted values should come from the authenticated session:

```ts
import { dashuRoute } from "@rophpad/dashu-next";

export const POST = dashuRoute(dashu, {
  getActor: async (request) => {
    const session = await requireSession(request);
    const membership = await loadActiveMembership(session.user.id);

    if (!membership || !membership.permissions.includes("dashu:ask")) {
      return null;
    }

    return {
      id: session.user.id,
      tenantId: membership.tenantId,
      permissions: membership.permissions,
    };
  },

  selectDataSource: ({ actor }) => sourceForTenant(actor.tenantId!),

  getPolicy: ({ actor }) => policyForMembership(actor),

  getSemanticLayer: ({ actor, dataSource }) =>
    approvedSemantics(actor.tenantId!, dataSource),
});
```

The helper functions in this example must perform server-side allow-list lookups. Never return a client-provided source key, schema name, role, permission list, or tenant ID. `createDashu` accepts only preconfigured adapter keys, which prevents a selected key from becoming an arbitrary connection string, but choosing the wrong configured key can still cross tenants.

Core checks `dashu:ask` for both natural-language questions and stored-SQL replay. Schema browsing checks `dashu:view-schema`. SQL disclosure/export/save permissions are `dashu:view-sql`, `dashu:export`, and `dashu:save-dashboard`; equivalent `askdb:*` names are accepted for compatibility.

Authentication, CSRF, origin checks, request/body limits, and actor/tenant rate limits remain host responsibilities. In particular, protect cookie-authenticated POST routes with the framework's CSRF mechanism and apply limits before a provider or database call starts.

## Understand request-policy semantics

`getPolicy` returns trusted per-request policy. It is not read from the standard Next adapter's body. Resolve behavior from `packages/core/src/policy.ts` is:

| Field | Merge behavior | Security effect |
|---|---|---|
| `schemas` | Request value replaces base value | Can switch or broaden schemas if server logic supplies them; `[]` uses adapter defaults |
| `denyTables` | Appended to base denials | Can only hide more tables |
| `denyColumns` | Appended to base denials | Can only hide more columns |
| `maxRows` | Request value replaces base, capped at 10,000 | Can raise or lower the base limit |
| `statementTimeoutMs` | Request value replaces base, capped at 120,000 ms | Can raise or lower the base timeout |
| `exposeSql` | Base AND request-not-false | Request can disable but cannot enable disclosure |
| `allowExport` | Base AND request-not-false | Request can disable but cannot enable capability |
| `allowSaveDashboard` | Base AND request-not-false | Request can disable but cannot enable capability |

For `ask` and `run`, actor-derived disclosure booleans are spread after instance defaults and therefore become the base values before request policy is intersected. An actor without `dashu:view-sql` cannot regain SQL disclosure through `getPolicy`; an actor with it has a true base even if `defaults.exposeSql` was false, unless request policy explicitly narrows it to false. Conversely, a bad `getPolicy` implementation can select another approved schema or raise limits, so treat it as authorization code and test it.

Deny rules filter what is rendered into the provider prompt and what the schema endpoint returns. They do not revoke PostgreSQL access. Back every deny rule with grants, curated views, column privileges where suitable, or RLS.

`capabilities.showSql` is enforced by core: `query` is absent from the response when false. `export` and `saveDashboard` are flags because Dashu has no export/save endpoints. Reauthorize those actions in host APIs; an export flag cannot retract rows already returned to the browser.

## Pattern 1: database or data source per tenant

This provides the strongest operational boundary: each tenant maps to an adapter with a tenant-specific database credential. Pools are keyed by connection string, so adapters do not share a mutable “current” connection.

```ts
const tenantSources = new Map([
  ["tenant_a", "tenant-a"],
  ["tenant_b", "tenant-b"],
]);

function sourceForTenant(tenantId: string): string {
  const source = tenantSources.get(tenantId);
  if (!source) throw new Error("No approved analytics source for tenant");
  return source;
}

const dashu = createDashu({
  ai,
  dataSources: {
    "tenant-a": postgresAdapter({
      connectionString: process.env.DASHU_TENANT_A_DATABASE_URL!,
      schemas: ["analytics"],
    }),
    "tenant-b": postgresAdapter({
      connectionString: process.env.DASHU_TENANT_B_DATABASE_URL!,
      schemas: ["analytics"],
    }),
  },
});
```

Use a dedicated read-only role in every database. Do not dynamically build connection strings from raw tenant IDs, and do not expose environment-variable names or source keys as a browser choice. For many tenants, build and cache adapters from a server-side credential registry with explicit lifecycle, rotation, and pool limits; never store a request-global “current tenant connection.”

**Advantages:** strongest blast-radius reduction, simple SQL, tenant-specific backup/retention/region.

**Costs:** more credentials, migrations, pools, monitoring, and connection pressure.

**Tests:** make the tenant A actor ask for a tenant B-only sentinel and verify the selected source and returned data remain A; separately connect with A's database credential and prove B's database cannot be reached.

## Pattern 2: schema per tenant

Each tenant has a dedicated schema in one database. The host maps tenant membership to an allow-listed schema and returns it in policy:

```ts
const tenantSchemas = new Map([
  ["tenant_a", "tenant_a_analytics"],
  ["tenant_b", "tenant_b_analytics"],
]);

function schemaForTenant(tenantId: string): string {
  const schema = tenantSchemas.get(tenantId);
  if (!schema) throw new Error("No approved schema for tenant");
  return schema;
}

const route = dashuRoute(dashu, {
  getActor,
  selectDataSource: () => "shared-cluster",
  getPolicy: ({ actor }) => ({
    schemas: [schemaForTenant(actor.tenantId!)],
    maxRows: 200,
    statementTimeoutMs: 10_000,
    exposeSql: actor.permissions.includes("dashu:view-sql"),
  }),
});
```

A shared database login with `SELECT` on every tenant schema makes policy filtering the only tenant boundary, which is too weak. Prefer a tenant-specific login/adapter whose grants include only that tenant schema, even if all adapters point to the same database. If operational constraints require one login, expose curated security-barrier views or use RLS-backed shared tables and treat schema filtering as prompt minimization rather than isolation.

For a tenant-specific role:

```sql
CREATE ROLE dashu_tenant_a LOGIN PASSWORD 'replace-me'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE app_database TO dashu_tenant_a;
GRANT USAGE ON SCHEMA tenant_a_analytics TO dashu_tenant_a;
GRANT SELECT ON ALL TABLES IN SCHEMA tenant_a_analytics TO dashu_tenant_a;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA tenant_a_analytics
  GRANT SELECT ON TABLES TO dashu_tenant_a;

ALTER ROLE dashu_tenant_a IN DATABASE app_database
  SET default_transaction_read_only = on;

-- Explicitly ensure no accidental access to another tenant.
REVOKE ALL ON SCHEMA tenant_b_analytics FROM dashu_tenant_a;
```

The PostgreSQL adapter's schema cache key includes the connection string and requested schema list, preventing a catalog cached for one schema policy from being returned under another schema list. Denied tables/columns are filtered after introspection on every request. This cache design reduces one cross-policy risk but does not compensate for overbroad database grants.

Be explicit about object resolution: schema-qualify analytics objects, restrict `search_path`, and revoke unneeded `CREATE` on shared schemas so an untrusted role cannot shadow names.

**Advantages:** one cluster and migration fleet, human-readable separation.

**Costs:** object count and migration fan-out; dangerous if a shared role can query all schemas.

**Tests:** inspect the schema endpoint and provider test double to ensure only the mapped schema appears, then execute direct SQL using the tenant login and verify `SELECT` on every other tenant schema fails with permission denied.

## Pattern 3: shared tables with PostgreSQL RLS

RLS is appropriate when tenants share tables. The database must derive the active tenant from trusted connection/session state, not from generated SQL. A common policy uses a transaction-local setting:

```sql
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.orders FORCE ROW LEVEL SECURITY;

CREATE POLICY orders_tenant_select ON app.orders
  FOR SELECT
  TO dashu_reader
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Apply equivalent policies to every tenant-bearing table that can be reached directly or through views/functions. `FORCE ROW LEVEL SECURITY` makes the table owner subject to RLS; superusers and roles with `BYPASSRLS` still bypass it, so the Dashu role must be `NOSUPERUSER NOBYPASSRLS` and should not own the tables. Confirm how views execute under your PostgreSQL version and define them so they cannot bypass the intended policy.

### Important adapter integration requirement

The current `postgresAdapter` does not accept tenant session variables and does not issue `SET LOCAL app.tenant_id`. Its execution sequence is internally:

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = ...;
-- execute validated query
ROLLBACK;
```

Therefore, do **not** deploy the setting-based RLS policy above with the stock adapter and assume `actor.tenantId` reaches PostgreSQL—it does not. Choose one of these safe integrations:

- create a small database-adapter extension that begins the transaction, parameterizes and sets `SET LOCAL app.tenant_id`, and then executes on that **same checked-out client and transaction**;
- use separate tenant roles/connections and write RLS policies against `current_user` or role membership; or
- expose tenant-specific data sources/views whose database grants already encode the tenant.

Never use a pool-level `SET app.tenant_id = ...` without `LOCAL`: pooled connections can leak session state between tenants. Never interpolate tenant IDs into SQL; parameterize them. Ensure transaction cleanup and discard/release behavior is correct even after errors and cancellation.

A role-based alternative avoids mutable session settings:

```sql
CREATE ROLE tenant_a_identity NOLOGIN;
GRANT tenant_a_identity TO dashu_tenant_a;

CREATE POLICY orders_tenant_a_select ON app.orders
  FOR SELECT
  TO tenant_a_identity
  USING (tenant_id = '00000000-0000-0000-0000-00000000000a'::uuid);
```

This is straightforward for a smaller tenant count but creates many roles/policies. A mapping table keyed by `current_user` can reduce policies, provided the mapping table itself is tightly controlled and readable as required by the policy.

**Advantages:** shared physical model, database-enforced row filtering for arbitrary generated SELECTs.

**Costs:** policy complexity, owner/view/function bypass hazards, and required connection-context integration.

**Tests:** run queries without tenant context, with each tenant context, through joins, views, aggregates, CTEs, and stored SQL. Verify missing/invalid context fails closed or returns no rows—never all rows.

## Combine patterns when risk warrants it

Patterns are composable. Examples:

- database per regulated region, schema per tenant inside a region;
- schema-filtered prompts plus RLS on underlying shared tables;
- tenant-specific login plus RLS as a backstop;
- curated analytics views plus column denials to keep sensitive names out of provider prompts.

The independent controls should agree. If policy selects tenant A's schema while the database role is tenant B's role, fail the request rather than relying on one layer to correct the mismatch.

## History, saved SQL, and tenant changes

History contains previous questions and SQL and is sent to the provider. The adapter only shape-checks browser history and retains six turns; it does not prove the SQL came from the current actor, tenant, source, or policy. Treat it as untrusted context:

- key persisted conversations by actor/tenant and data source;
- clear history when tenant, source, or materially visible schema changes;
- avoid storing result values or secrets in SQL/history;
- impose per-field/body size limits; and
- do not use history as authorization evidence.

A history query is never executed by `ask`. In contrast, `dashu.run` executes stored SQL without a model call. Core revalidates that SQL under the current query policy and applies the current row cap and timeout, which protects against writes and stale limits. It does not parse table references against the current filtered prompt schema; database grants/RLS remain essential when a saved dashboard is replayed after membership or policy changes.

Persist SQL only when `capabilities.saveDashboard` is true **and** a host save endpoint independently authorizes the actor. When loading/running a saved item, verify tenant ownership and choose the source/policy from current membership rather than from saved client-controlled metadata.

## Testing tenant isolation

Tenant isolation tests need a real disposable PostgreSQL instance. Model/unit tests alone cannot prove grants or RLS. Run the suite with the exact runtime roles and adapter path used in production.

### 1. Authorization and routing tests

- unauthenticated request is rejected;
- authenticated actor without `dashu:ask` is rejected by core;
- actor without `dashu:view-schema` cannot use the schema route;
- actor cannot select a source/schema/tenant through JSON or query parameters;
- unknown, disabled, and cross-tenant memberships fail closed;
- `getPolicy` never derives schemas/limits from untrusted body values;
- cookie-authenticated POSTs reject missing/invalid CSRF tokens or foreign origins;
- per-actor and per-tenant rate limits fire before provider/database calls.

### 2. Policy and prompt-disclosure tests

Use a recording/fake `DashuAiProvider` and inspect its `messages`:

- only the tenant's visible schemas, tables, columns, relationships, comments, and enum values appear;
- denied objects and relationships to denied tables do not appear;
- semantic terms belong to the selected tenant/source;
- only the last six history turns appear;
- history SQL appears as provider context but is not sent to the database;
- a request policy can change `schemas`, `maxRows`, and timeout as expected;
- a request cannot enable SQL/export/save disclosure when the actor-derived base is false;
- when `exposeSql` is false, the HTTP result has no `query` field.

Remember that prompt filtering is a disclosure test, not proof of database isolation.

### 3. Database privilege tests

Connect as each Dashu runtime login and verify:

- approved views/tables can be selected;
- writes, DDL, `SELECT ... INTO`, and unapproved functions fail;
- other tenant databases/schemas/tables fail;
- role is not superuser, owner, or `BYPASSRLS`;
- default privileges protect objects created after migrations;
- read-only transaction and statement timeout are active;
- cancellation does not leave a transaction or tenant setting on a pooled connection.

### 4. RLS matrix

Create sentinel rows for tenants A and B and test each relation through:

| Context | Expected rows |
|---|---|
| no tenant | none or explicit error |
| invalid tenant | none or explicit error |
| tenant A | A only |
| tenant B | B only |
| runtime role attempting `SET ROLE`/bypass | denied |

Repeat for direct selects, joins, subqueries, CTEs, aggregates, views, functions, prepared/stored SQL replay, and every table reachable from the analytics schema. Test table-owner and migration roles separately to confirm they are never used by Dashu.

### 5. Adversarial generated SQL

Stub the provider to return known hostile plans and assert the guard/database layers reject them:

```sql
DELETE FROM app.orders;
WITH x AS (DELETE FROM app.orders RETURNING *) SELECT * FROM x;
SELECT * INTO stolen FROM app.orders;
SELECT pg_read_file('/etc/passwd');
SELECT pg_sleep(60);
SELECT * FROM tenant_b_analytics.secret;
```

Also deliberately bypass the guard in a test harness and prove the PostgreSQL read-only transaction and role grants still reject writes. This validates defense in depth rather than only the lexical checker.

### 6. Repair and error tests

- a normal PostgreSQL execution error causes one repair call containing the first SQL and driver detail;
- guard rejection, timeout, and cancellation cause no repair call;
- corrected SQL is validated and executes with the same tenant context and policy;
- there is no second repair after corrected SQL fails;
- driver/provider detail never appears in the HTTP response;
- logs and provider recording demonstrate which identifiers/error values leave each boundary.

Connection failures currently use `QUERY_FAILED` and can trigger the one repair call; include that behavior in cost/telemetry tests if it matters operationally.

## Deployment checklist

- [ ] Actor, tenant, permissions, source, policy, and semantics come from server-side session/membership data
- [ ] Every tenant maps through an explicit allow-list
- [ ] PostgreSQL login is dedicated, read-only, non-owner, `NOSUPERUSER`, and `NOBYPASSRLS`
- [ ] Schema filtering is backed by grants/views/RLS
- [ ] Setting-based RLS is integrated on the same transaction/client; no pooled session leakage
- [ ] History and saved SQL are scoped to tenant/source and bounded
- [ ] Save/export operations reauthorize on the server
- [ ] CSRF, origin/CORS, body, concurrency, and rate limits are applied by the host
- [ ] Cross-tenant negative tests run against real PostgreSQL and exact production roles

## Source references

- `packages/core/src/types.ts` — actor/tenant contract, permissions, history, capabilities
- `packages/core/src/policy.ts` — exact policy merge and disclosure intersection
- `packages/core/src/ask.ts` — permission checks, source selection, repair, stored-SQL validation
- `packages/core/src/planning.ts` — schema/history/provider message flow
- `packages/adapter-next/src/index.ts` — trusted callbacks and untrusted body parsing
- `packages/database-postgres/src/index.ts` — pool/cache keys and transaction lifecycle
- `packages/database-postgres/src/guard.ts` — read-only SQL guard and row cap
