# Dashu developer documentation

This documentation explains how to integrate, secure, operate, customize, and extend the Dashu packages. It is organized so that a developer can start with no Dashu knowledge and progressively move to advanced integration work.

## Choose your path

### I want a working Next.js integration

1. [Prerequisites and package selection](getting-started/prerequisites.md)
2. [Next.js quick start](getting-started/nextjs-quickstart.md)
3. [Route contracts](guides/routes-and-frameworks.md#nextjs-route-contracts)
4. [Security model](security/security-model.md)
5. [Operations and troubleshooting](guides/operations-and-troubleshooting.md)

### I use Express, Fastify, NestJS, Hono, or another backend

1. [Prerequisites and package selection](getting-started/prerequisites.md)
2. [Core integration for any backend](getting-started/framework-agnostic.md)
3. [Authorization, policy, and multi-tenancy](guides/authorization-policy-multitenancy.md)
4. [Result contract](reference/result-contract.md)

### I am choosing an AI provider

Read [AI provider selection and configuration](guides/providers.md). It compares OpenRouter, OpenAI-compatible/self-hosted endpoints, Managed AI, and custom provider implementations, including what information crosses each boundary.

### I am building the UI

Read [React and custom UI](guides/react-and-custom-ui.md), then use the [result contract](reference/result-contract.md) if you want to render without `@rophpad/dashu-react`.

### I need production/security guidance

- [Security model and PostgreSQL hardening](security/security-model.md)
- [Authorization, policies, and multi-tenancy](guides/authorization-policy-multitenancy.md)
- [Operations and troubleshooting](guides/operations-and-troubleshooting.md)
- [Errors and HTTP statuses](reference/errors.md)

### I want to contribute or extend Dashu

- [Contributor guide](../CONTRIBUTING.md)
- [Development and architecture](contributing/development.md)
- [Package API reference](reference/packages.md)

## Guides

| Guide | What it covers |
|---|---|
| [Prerequisites](getting-started/prerequisites.md) | Runtime, framework, database, package, and environment requirements |
| [Next.js quick start](getting-started/nextjs-quickstart.md) | Complete App Router server and React setup |
| [Framework-agnostic setup](getting-started/framework-agnostic.md) | Calling core from any backend and safely mapping errors |
| [Routes and frameworks](guides/routes-and-frameworks.md) | Next.js ask/run/schema endpoints and generic HTTP contracts |
| [Providers](guides/providers.md) | Provider choice, options, local models, retries, timeouts, and privacy |
| [React and custom UI](guides/react-and-custom-ui.md) | Hook, components, themes, custom renderers, CSV, and follow-ups |
| [Semantic layer and saved queries](guides/semantic-layer-and-saved-queries.md) | Business vocabulary, persistence, replay, and authorization |
| [Authorization and multi-tenancy](guides/authorization-policy-multitenancy.md) | Actors, permissions, policies, tenant isolation, CSRF, and rate limiting |
| [Operations and troubleshooting](guides/operations-and-troubleshooting.md) | Observability, deployment, pools, cache, shutdown, and runbooks |

## Reference

| Reference | Contents |
|---|---|
| [All packages](reference/packages.md) | Every package, export, option, default, and runtime constraint |
| [Result contract](reference/result-contract.md) | Answered/unanswerable results, data, display, metadata, and capabilities |
| [Errors](reference/errors.md) | Error codes, HTTP statuses, safe/detail split, and handling |

## Supported package set

| Package | Install it when… |
|---|---|
| `@rophpad/dashu-core` | Always; it provides contracts and the query pipeline |
| `@rophpad/dashu-database-postgres` | You query PostgreSQL |
| `@rophpad/dashu-next` | You use Next.js App Router route handlers |
| `@rophpad/dashu-react` | You want the React hook or built-in renderers |
| `@rophpad/dashu-provider-openrouter` | You use your own OpenRouter account |
| `@rophpad/dashu-provider-openai-compatible` | You use Ollama, vLLM, LocalAI, llama.cpp, or a compatible gateway |
| `@rophpad/dashu-provider-managed` | You use Dashu Managed AI |

Only install the database adapter, framework adapter, UI package, and provider that your application needs.

## Important design boundaries

- Dashu is a backend query-planning and execution library, not an authentication system.
- The browser must call your authorized backend route; it must never receive database or provider credentials.
- PostgreSQL grants are the authoritative data boundary. Model prompts and SQL text validation are defense in depth.
- Result rows are not intentionally sent to an AI provider. Planning does send approved schema metadata, the question, semantic vocabulary, prior history SQL, and—in one repair attempt—a bounded database error that may contain identifiers or literals.
- `tenantId` is context for host routing and telemetry. It does not filter rows by itself.
- Export and save-dashboard capability fields guide trusted UI behavior. Any server endpoint that exports or persists data must perform its own authorization.
