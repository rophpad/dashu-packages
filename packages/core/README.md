# @rophpad/dashu-core

Framework-independent Dashu contracts and query pipeline: policy, schema filtering, AI planning, SQL execution orchestration, result shaping, display validation, and safe errors.

## Install

```bash
npm install @rophpad/dashu-core
```

You also need a database adapter and AI provider.

## Minimum usage

```ts
import { createDashu } from "@rophpad/dashu-core";
import { postgresAdapter } from "@rophpad/dashu-database-postgres";
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

const dashu = createDashu({
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
  defaults: { maxRows: 200, statementTimeoutMs: 10_000 },
});

const result = await dashu.ask({
  question: "Revenue by month",
  actor: { id: "admin-1", permissions: ["dashu:ask"] },
});
```

`createDashu` returns `ask`, `run`, `schema`, `testConnection`, and `dataSourceNames`. Actors must come from authenticated server state. `tenantId` is context only and does not isolate rows.

## Documentation

- [Getting started](https://github.com/rophpad/dashu/blob/main/docs/getting-started/framework-agnostic.md)
- [Complete core and type reference](https://github.com/rophpad/dashu/blob/main/docs/reference/packages.md#rophpaddashu-core)
- [Result contract](https://github.com/rophpad/dashu/blob/main/docs/reference/result-contract.md)
- [Security model](https://github.com/rophpad/dashu/blob/main/docs/security/security-model.md)

## License

Apache-2.0
