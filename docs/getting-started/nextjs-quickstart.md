# Next.js App Router quick start

This tutorial builds a secure minimum integration with PostgreSQL, OpenRouter, Next.js App Router, and React.

## 1. Install packages

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres @rophpad/dashu-next @rophpad/dashu-react @rophpad/dashu-provider-openrouter
```

## 2. Create a read-only PostgreSQL identity

Do not use your application's write-capable credential. Create a role that can access only analytics views. Follow the complete SQL in [Provision a dedicated read-only PostgreSQL role](../security/security-model.md#provision-a-dedicated-read-only-postgresql-role).

At minimum, verify:

```sql
SET ROLE dashu_reader;
SELECT * FROM analytics.monthly_revenue LIMIT 1;
CREATE TABLE must_fail (id integer); -- must fail
RESET ROLE;
```

## 3. Add server-only environment variables

Create or update `.env.local`:

```dotenv
DASHU_DATABASE_URL=postgresql://dashu_reader:replace-me@localhost:5432/my_app
OPENROUTER_API_KEY=replace-me
```

Restart the development server after changing environment variables. Never use `NEXT_PUBLIC_` for either value.

## 4. Create the server Dashu instance

Create `src/lib/dashu.ts` (or `lib/dashu.ts` if your project does not use `src`):

```ts
import "server-only";

import { createDashu } from "@rophpad/dashu-core";
import { postgresAdapter } from "@rophpad/dashu-database-postgres";
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

function required(name: "DASHU_DATABASE_URL" | "OPENROUTER_API_KEY"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const dashu = createDashu({
  ai: openRouterProvider({
    apiKey: required("OPENROUTER_API_KEY"),
    model: "openai/gpt-4.1-mini",
    title: "My product analytics",
  }),

  dataSources: {
    analytics: postgresAdapter({
      connectionString: required("DASHU_DATABASE_URL"),
      schemas: ["analytics"],
      applicationName: "my-product-dashu",
    }),
  },
  defaultDataSource: "analytics",

  defaults: {
    maxRows: 200,
    statementTimeoutMs: 10_000,
    exposeSql: false,
    allowExport: false,
    allowSaveDashboard: false,
    denyTables: [],
    denyColumns: [],
  },

  onEvent(event) {
    // Metadata only: no question, SQL, or result rows.
    console.info("dashu.request", event);
  },
});
```

`server-only` makes accidental client imports fail during a Next.js build.

## 5. Connect your authentication

Dashu cannot know how your app authenticates users. Implement a server function that returns your existing authenticated user. The exact code depends on Auth.js, Clerk, Better Auth, Supabase Auth, or your own session system.

The important rule is that actor values come from the verified server session, never the request body:

```ts
// src/lib/dashu-auth.ts
import "server-only";
import type { DashuActor } from "@rophpad/dashu-core";
import { currentUser } from "@/lib/auth"; // your existing server auth helper

export async function getDashuActor(): Promise<DashuActor | null> {
  const user = await currentUser();
  if (!user || !user.isAdmin) return null;

  return {
    id: user.id,
    tenantId: user.tenantId,
    permissions: [
      "dashu:ask",
      "dashu:view-schema",
      // Add these only when your product permits the action:
      // "dashu:view-sql",
      // "dashu:export",
      // "dashu:save-dashboard",
    ],
  };
}
```

Do not copy `isAdmin`, `tenantId`, or permissions from JSON submitted by the browser.

## 6. Add the ask route

Create `src/app/api/dashu/ask/route.ts`:

```ts
import { dashuRoute } from "@rophpad/dashu-next";
import { dashu } from "@/lib/dashu";
import { getDashuActor } from "@/lib/dashu-auth";

export const runtime = "nodejs";

export const POST = dashuRoute(dashu, {
  getActor: () => getDashuActor(),

  // For a single data source this may be omitted.
  selectDataSource: ({ actor }) => {
    if (!actor.tenantId) return "analytics";
    return "analytics";
  },

  getSemanticLayer: () => ({
    terms: {
      revenue: "Sum of analytics.monthly_revenue.net_amount",
      active_customer: "A customer whose status is 'active'",
    },
    notes: ["Use UTC for date grouping."],
  }),
});
```

For multi-tenant applications, the example's constant data source is not sufficient unless PostgreSQL row-level security enforces isolation. Read [Authorization, policy, and multi-tenancy](../guides/authorization-policy-multitenancy.md).

### Ask request

The browser sends:

```json
{ "question": "Revenue by month this year" }
```

It may also send up to six history entries containing a previous question and disclosed SQL. Actor, policy, semantic layer, and data source remain server-controlled.

## 7. Add the client UI

Create `src/components/dashu-analytics.tsx`:

```tsx
"use client";

import {
  DashuComposer,
  DashuResult,
  useDashu,
} from "@rophpad/dashu-react";

export function DashuAnalytics() {
  const { ask, cancel, retry, reset, result, error, loading } = useDashu({
    endpoint: "/api/dashu/ask",
    keepHistory: true,
  });

  return (
    <section aria-labelledby="analytics-title">
      <h1 id="analytics-title">Ask your analytics data</h1>

      <DashuComposer
        onSubmit={ask}
        onCancel={cancel}
        loading={loading}
        suggestions={[
          "Revenue by month this year",
          "Top five countries by active customers",
        ]}
      />

      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {error.requestId && <small>Request: {error.requestId}</small>}
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}

      {result && (
        <>
          <DashuResult
            result={result}
            showSql={result.answered && result.capabilities.showSql}
          />
          <button type="button" onClick={reset}>Clear</button>
        </>
      )}
    </section>
  );
}
```

Render it from an administrator-only page. Hiding the page is good UX, but the API route remains the real authorization boundary.

## 8. Verify the integration

Test in this order:

1. Call `await dashu.testConnection()` from a temporary server-side script or health-check implementation.
2. Sign in as a user without Dashu access and verify `POST /api/dashu/ask` returns 403.
3. Sign in as an authorized administrator and ask a question based on an approved view.
4. Ask about a denied/unavailable field and verify Dashu does not expose it.
5. Confirm SQL is absent unless both the instance default enables `exposeSql` and the actor has `dashu:view-sql`.
6. Confirm a write attempt fails using the database role itself.
7. Review backend events and errors by request ID.

## Optional routes

Add replay and schema endpoints only if your product needs them. See [Next.js route contracts](../guides/routes-and-frameworks.md#nextjs-route-contracts) for exact files, request bodies, permissions, and responses.

## Next steps

- [Provider choices](../guides/providers.md)
- [React customization and CSV](../guides/react-and-custom-ui.md)
- [Semantic vocabulary and saved queries](../guides/semantic-layer-and-saved-queries.md)
- [Security model](../security/security-model.md)
- [Production operations](../guides/operations-and-troubleshooting.md)
