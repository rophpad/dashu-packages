# Dashu

**Talk to your database safely from your product's administrator area.** Dashu is a set of composable npm packages for turning natural-language questions into validated, read-only database queries and typed, renderable results.

Dashu runs inside your backend. Your application supplies authentication, authorization, database access, tenant isolation, and persistence; Dashu supplies planning, policy handling, SQL validation/execution adapters, a versioned result contract, and optional React UI.

## Start here

- **New to Dashu:** [complete developer documentation](docs/README.md)
- **Next.js:** [step-by-step App Router quick start](docs/getting-started/nextjs-quickstart.md)
- **Other backends:** [framework-agnostic integration](docs/getting-started/framework-agnostic.md)
- **Production review:** [security model](docs/security/security-model.md) and [operations guide](docs/guides/operations-and-troubleshooting.md)
- **Looking up an API:** [all package references](docs/reference/packages.md)
- **Contributing:** [contributor guide](CONTRIBUTING.md)

## Install

Choose one provider. For PostgreSQL, Next.js, React, and OpenRouter:

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres @rophpad/dashu-next @rophpad/dashu-react @rophpad/dashu-provider-openrouter
```

Use Node.js 20 or newer for the complete backend stack. The React package supports React 18+.

## Minimal server configuration

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
  },
});
```

Always use a dedicated PostgreSQL role with only `CONNECT`, approved schema `USAGE`, and approved table/view `SELECT`. Database grants—not model instructions—are the authoritative security boundary.

## Packages

| Package | Purpose |
|---|---|
| `@rophpad/dashu-core` | Framework-independent pipeline, policy, contracts, errors, and extension interfaces |
| `@rophpad/dashu-database-postgres` | PostgreSQL schema introspection, SQL guard, pooling, and read-only execution |
| `@rophpad/dashu-next` | Authorized App Router-style ask, run, and schema handlers |
| `@rophpad/dashu-react` | Client hook, composer, result renderer, charts, theming, and CSV formatting |
| `@rophpad/dashu-provider-openrouter` | OpenRouter provider configuration |
| `@rophpad/dashu-provider-openai-compatible` | Ollama, vLLM, LocalAI, llama.cpp, and compatible gateways |
| `@rophpad/dashu-provider-managed` | Dashu Managed AI provider configuration |

## Request flow

```text
browser
  -> your authenticated and rate-limited backend route
  -> Dashu policy + filtered schema
  -> AI provider plans SQL
  -> adapter validates SQL
  -> PostgreSQL read-only transaction executes it
  -> typed rows + validated display specification
  -> your UI
```

### Data sent to the AI provider

Planning sends the natural-language question, approved filtered schema metadata, optional semantic vocabulary, and optional previous question/SQL history. If the first SQL execution fails, one repair attempt may also send failed SQL and a bounded database error that can contain identifiers or literals.

Database credentials, session cookies, and result rows are not intentionally sent to the provider. Review the precise [security and data-flow model](docs/security/security-model.md) before production use.

## Security responsibilities

Dashu provides defense in depth, but your application must:

- derive actors and permissions from authenticated server state;
- isolate tenants with separate databases/schemas or PostgreSQL row-level security;
- keep database/provider credentials server-only;
- configure database grants on approved views/tables;
- apply CSRF/origin controls, body limits, and rate limits;
- independently authorize any persistence or server-side export endpoint.

`tenantId` is routing and telemetry context; it does not filter rows. Export and save-dashboard capabilities guide UI behavior; they cannot revoke data already delivered to a browser.

## Result contract

Dashu returns a discriminated `AskResult`:

```ts
if (result.answered) {
  console.log(result.data.columns, result.data.rows);
  console.log(result.display.primary);
} else {
  console.log(result.answer.text); // honest unanswerable outcome, not an error
}
```

Read the [complete result contract](docs/reference/result-contract.md) for numeric strings, duplicate column keys, truncation, displays, metadata, SQL disclosure, and capabilities.

## Documentation map

- [Prerequisites and package selection](docs/getting-started/prerequisites.md)
- [Next.js quick start](docs/getting-started/nextjs-quickstart.md)
- [Framework-agnostic setup](docs/getting-started/framework-agnostic.md)
- [Routes and framework contracts](docs/guides/routes-and-frameworks.md)
- [Provider selection](docs/guides/providers.md)
- [React and custom UI](docs/guides/react-and-custom-ui.md)
- [Semantic layer and saved queries](docs/guides/semantic-layer-and-saved-queries.md)
- [Authorization, policy, and multi-tenancy](docs/guides/authorization-policy-multitenancy.md)
- [Operations and troubleshooting](docs/guides/operations-and-troubleshooting.md)
- [Package API reference](docs/reference/packages.md)
- [Errors and statuses](docs/reference/errors.md)
- [Development and architecture](docs/contributing/development.md)

## Current scope

The included database adapter supports PostgreSQL. The included framework adapter targets Web `Request`/`Response` handlers and is designed for Next.js App Router. Core is framework-independent and exposes interfaces for custom providers and database adapters.

## License

Apache-2.0
