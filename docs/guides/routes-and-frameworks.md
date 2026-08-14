# Routes and framework integration

This guide documents the HTTP surface supplied by `@rophpad/dashu-next` and the equivalent contract for other frameworks.

## Trust boundary

Only `question`, bounded history, or stored `sql` come from request JSON. The route obtains actor, data source, policy, and semantic vocabulary from trusted server callbacks.

Do not modify this pattern by accepting actor permissions, a tenant connection string, policy, schema names, or provider credentials from the browser.

## Shared `DashuRouteOptions`

```ts
type DashuRouteOptions = {
  getActor(request: Request): DashuActor | null | Promise<DashuActor | null>;
  selectDataSource?(context: { actor: DashuActor; request: Request }):
    string | undefined | Promise<string | undefined>;
  getPolicy?(context: { actor: DashuActor; request: Request }):
    DashuPolicyInput | undefined | Promise<DashuPolicyInput | undefined>;
  getSemanticLayer?(context: { actor: DashuActor; dataSource?: string }):
    SemanticLayer | undefined | Promise<SemanticLayer | undefined>;
  onAnswer?(context: { actor: DashuActor; question: string; result: AskResult }):
    void | Promise<void>;
};
```

`getActor` is required. Returning `null` produces a generic 403 response.

`getPolicy` is trusted host code. Disclosure booleans cannot widen instance defaults, but schemas and numeric limits can differ from defaults within core ceilings. Never derive policy directly from arbitrary request JSON.

## Next.js route contracts

All routes using PostgreSQL should declare:

```ts
export const runtime = "nodejs";
```

### Ask route

File: `app/api/dashu/ask/route.ts`

```ts
import { dashuRoute } from "@rophpad/dashu-next";
import { dashu } from "@/lib/dashu";
import { routeOptions } from "@/lib/dashu-route-options";

export const runtime = "nodejs";
export const POST = dashuRoute(dashu, routeOptions);
```

Request:

```jsonc
{
  "question": "Revenue by month",
  "history": [
    { "question": "Revenue this year", "sql": "SELECT ..." }
  ]
}
```

- Invalid JSON returns `INVALID_REQUEST`.
- Non-string questions become an empty question and core rejects them.
- Invalid history entries are dropped.
- Only the final six structurally valid history entries are retained.
- The request abort signal propagates to provider/database work.
- `onAnswer` runs for both answered and honest unanswerable results because both are successful `AskResult` responses.

Success: HTTP 200 with `AskResult`.

### Stored-query replay route

File: `app/api/dashu/run/route.ts`

```ts
import { dashuRunRoute } from "@rophpad/dashu-next";
import { dashu } from "@/lib/dashu";
import { routeOptions } from "@/lib/dashu-route-options";

export const runtime = "nodejs";
export const POST = dashuRunRoute(dashu, routeOptions);
```

Request:

```json
{ "sql": "SELECT month, revenue FROM analytics.monthly_revenue" }
```

The route does not call the AI provider. Core checks `dashu:ask`, resolves current policy, validates the SQL again, executes in a read-only transaction, and applies the current row limit and timeout.

Do not expose this as a general SQL console. Normally the server loads stored SQL by an opaque dashboard/query ID after verifying ownership. Accepting arbitrary browser SQL broadens your attack surface even though the guard and database grants still apply.

### Schema route

File: `app/api/dashu/schema/route.ts`

```ts
import { dashuSchemaRoute } from "@rophpad/dashu-next";
import { dashu } from "@/lib/dashu";
import { routeOptions } from "@/lib/dashu-route-options";

export const runtime = "nodejs";
export const GET = dashuSchemaRoute(dashu, routeOptions);
```

The actor needs `dashu:view-schema`.

Response:

```jsonc
{
  "version": "1",
  "schema": {
    "tables": [],
    "relationships": [],
    "readAt": 1720000000000
  }
}
```

`GET /api/dashu/schema?refresh=1` forces a fresh introspection. Restrict refresh use because repeated catalog reads add database load.

## Reuse route options

```ts
import type { DashuRouteOptions } from "@rophpad/dashu-next";
import { getDashuActor } from "./dashu-auth";

export const routeOptions: DashuRouteOptions = {
  getActor: () => getDashuActor(),
  selectDataSource: ({ actor }) => sourceForTenant(actor.tenantId),
  getPolicy: ({ actor }) => ({
    schemas: schemasForTenant(actor.tenantId),
    maxRows: actor.permissions.includes("analytics:large-results") ? 1000 : 200,
  }),
  getSemanticLayer: ({ dataSource }) => semanticLayerFor(dataSource),
};
```

`sourceForTenant`, `schemasForTenant`, and `semanticLayerFor` are host functions, not Dashu exports.

## Cross-cutting HTTP controls

The adapter does not implement:

- login/session validation beyond calling your `getActor`;
- CSRF or origin verification;
- request body limits;
- rate limits or provider budget quotas;
- persistence;
- response caching;
- audit retention policy.

Apply these in middleware or your host platform. Do not cache ask responses across users or tenants.

## Error responses

All handlers return:

```json
{
  "error": {
    "code": "QUERY_NOT_ALLOWED",
    "message": "Safe message for the user.",
    "requestId": "req_..."
  }
}
```

The adapter logs `DashuError.detail` server-side and never serializes it. See [Errors](../reference/errors.md).

## Other frameworks

Replicate the same sequence rather than trying to invoke the Next.js handler abstraction:

1. authenticate;
2. construct actor;
3. server-select source, policy, and semantics;
4. call `dashu.ask`, `dashu.run`, or `dashu.schema`;
5. map errors with `errorStatus` and `toErrorResponse`;
6. propagate cancellation where supported.

See [framework-agnostic setup](../getting-started/framework-agnostic.md) for code.
