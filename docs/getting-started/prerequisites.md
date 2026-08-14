# Prerequisites and package selection

This page lists what you need before integrating Dashu and explains which packages belong in each part of an application.

## Runtime requirements

### Backend

Use **Node.js 20 or newer**.

The OpenAI-compatible provider uses modern global APIs including `fetch`, `AbortSignal.timeout`, and `AbortSignal.any`. The PostgreSQL adapter also uses Node-only modules and APIs. Although package manifests do not currently declare an `engines` field, Node 20+ is the practical supported floor for the complete stack.

### Frontend

`@rophpad/dashu-react` requires React 18 or newer. It is a client-side package: `useDashu` uses browser `fetch`, and the interactive components use React state and DOM events.

In a Next.js App Router project, import it from a component with a `"use client"` boundary.

### Next.js

`@rophpad/dashu-next` exports Web `Request`/`Response` handlers suited to the App Router. It does not import Next.js directly.

When using `@rophpad/dashu-database-postgres`, run routes in the **Node.js runtime**, not the Edge runtime:

```ts
export const runtime = "nodejs";
```

### Database

The included adapter supports PostgreSQL. The database identity should be a dedicated analytics role with only:

- `CONNECT` on the approved database;
- `USAGE` on approved schemas;
- `SELECT` on approved tables or, preferably, purpose-built views.

See [Security model](../security/security-model.md#provision-a-dedicated-read-only-postgresql-role) for SQL setup.

## Choose packages

Every integration needs core, one database adapter, and one AI provider. Framework and UI packages are optional.

### Next.js + React + PostgreSQL + OpenRouter

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres @rophpad/dashu-next @rophpad/dashu-react @rophpad/dashu-provider-openrouter
```

### Next.js + React + PostgreSQL + a self-hosted model

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres @rophpad/dashu-next @rophpad/dashu-react @rophpad/dashu-provider-openai-compatible
```

### Custom backend without the built-in React UI

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres @rophpad/dashu-provider-openrouter
```

Use npm, pnpm, or Yarn according to your project. The commands in this documentation use npm.

## Required host-application capabilities

Dashu deliberately does not provide these. Your application must already have, or implement:

1. **Authentication** — resolve the current user from a trusted session or token.
2. **Authorization** — decide which users may ask, view SQL, export, save queries, or inspect schemas.
3. **Tenant isolation** — database-per-tenant, schema-per-tenant, or PostgreSQL row-level security.
4. **Secret management** — keep database URLs and provider credentials in server-only environment variables or a secret manager.
5. **Abuse controls** — CSRF protection where relevant, rate limiting, quotas, and audit policy.
6. **Persistence** — if you want history or dashboards. Dashu stores nothing by itself.

## Environment variables

A typical OpenRouter setup needs:

```dotenv
DASHU_DATABASE_URL=postgresql://dashu_reader:replace-me@localhost:5432/my_app
OPENROUTER_API_KEY=replace-me
```

Rules:

- Do not prefix secrets with `NEXT_PUBLIC_`.
- Do not import the server Dashu instance into client components.
- Use separate credentials per environment.
- URL-encode special characters in connection-string usernames/passwords.
- Add provider-specific variables only on the backend.

## TypeScript and module support

Packages publish ESM, CommonJS, and declaration files. Import from package roots:

```ts
import { createDashu } from "@rophpad/dashu-core";
```

Do not deep-import internal source or `dist` files. Those paths are not public exports and can change without notice.

## Verify prerequisites

Before wiring a browser:

1. Confirm `node --version` is 20 or newer.
2. Confirm the database role can run `SELECT 1`.
3. Confirm it can select an approved view but cannot write to it.
4. Confirm your server can reach the provider endpoint.
5. Confirm your auth layer can derive an immutable server-side actor ID and permissions.

Then continue with the [Next.js quick start](nextjs-quickstart.md) or [framework-agnostic setup](framework-agnostic.md).
