# Integrating Dashu with any backend

`@rophpad/dashu-core` has no framework dependency. Express, Fastify, NestJS, Hono, server functions, jobs, and CLI tools can call the same `Dashu` instance directly.

## Configure once on the backend

```ts
import { createDashu } from "@rophpad/dashu-core";
import { postgresAdapter } from "@rophpad/dashu-database-postgres";
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

export const dashu = createDashu({
  ai: openRouterProvider({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: "openai/gpt-4.1-mini",
  }),
  dataSources: {
    main: postgresAdapter({
      connectionString: process.env.DASHU_DATABASE_URL!,
      schemas: ["analytics"],
    }),
  },
  defaultDataSource: "main",
  defaults: {
    maxRows: 200,
    statementTimeoutMs: 10_000,
    exposeSql: false,
    allowExport: false,
    allowSaveDashboard: false,
  },
});
```

Keep this module out of browser bundles. Reuse the instance so the PostgreSQL pool and schema cache can be reused.

## Handle a question

Your handler must perform these steps in order:

1. Authenticate the request.
2. Authorize the user.
3. Build a trusted `DashuActor`.
4. Select an approved data-source key; never accept a connection string from the request.
5. Derive policy and semantic vocabulary on the server.
6. Call `dashu.ask` and pass the disconnect/abort signal if your framework exposes one.
7. Serialize a safe error response.

```ts
import {
  DashuError,
  errorStatus,
  toErrorResponse,
  type DashuActor,
} from "@rophpad/dashu-core";
import { dashu } from "./dashu";

export async function answerQuestion(input: {
  question: unknown;
  actor: DashuActor;
  signal?: AbortSignal;
}) {
  try {
    return {
      status: 200,
      body: await dashu.ask({
        question: typeof input.question === "string" ? input.question : "",
        actor: input.actor,
        dataSource: "main",
        semantic: {
          terms: { revenue: "Sum of analytics.orders.net_total" },
          notes: ["All timestamps are UTC."],
        },
        signal: input.signal,
      }),
    };
  } catch (error) {
    const requestId =
      error instanceof DashuError && error.requestId
        ? error.requestId
        : "req_unknown";

    if (error instanceof DashuError && error.detail) {
      console.error(`[dashu] ${requestId} ${error.code}: ${error.detail}`);
    }

    return {
      status: errorStatus(error),
      body: toErrorResponse(error, requestId),
    };
  }
}
```

Never send `DashuError.detail`, an unexpected exception message, stack trace, provider payload, or database connection error directly to a client.

## Express-style example

```ts
app.post("/api/dashu/ask", async (req, res) => {
  const user = await requireCurrentUser(req);
  if (!user.isAdmin) return res.status(403).json({
    error: { code: "FORBIDDEN", message: "Administrator access is required." },
  });

  const response = await answerQuestion({
    question: req.body?.question,
    actor: {
      id: user.id,
      tenantId: user.tenantId,
      permissions: user.permissions,
    },
  });

  return res.status(response.status).json(response.body);
});
```

Add your framework's body-size limit, CSRF/origin checks, request rate limit, and cancellation mapping.

## Direct core methods

### `ask(request)`

Plans a query with the provider, validates it, executes it, and returns `AskResult`. Questions are trimmed, must be non-empty, and are limited to 2,000 characters. At most the last six history turns are used.

### `run(request)`

Executes stored SQL without calling the model. The current actor permission and current policy still apply, and SQL is revalidated before every execution.

### `schema(request)`

Returns the policy-filtered approved schema. The actor needs `dashu:view-schema`. Set `force: true` to bypass the adapter's schema cache for that read.

### `testConnection(dataSource?)`

Tests the selected configured adapter. This is an operator/health utility and does not take an actor or policy.

### `dataSourceNames()`

Returns configured source keys. Do not expose this automatically to untrusted clients if source names reveal tenant or infrastructure information.

## Client contract

Your frontend may use `@rophpad/dashu-react` against any endpoint that accepts the same ask JSON and returns either an `AskResult` or a structured error. It does not require the Next.js adapter.

Read:

- [Routes and framework contracts](../guides/routes-and-frameworks.md)
- [Result contract](../reference/result-contract.md)
- [Error reference](../reference/errors.md)
- [Authorization and multi-tenancy](../guides/authorization-policy-multitenancy.md)
