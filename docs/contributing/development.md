# Development guide

This repository is an npm workspace containing the public Dashu TypeScript packages. This guide describes the commands and structure that exist in this checkout.

## Prerequisites and setup

Use **Node.js 20 or newer**. The provider implementation uses `AbortSignal.any`, which is available in Node 20+, and every package compiles to ES2022. Use npm: the repository has a root `package-lock.json` and declares `packages/*` as npm workspaces.

From the repository root:

```bash
npm install
npm run build
npm run typecheck
npm test
```

`npm install` links the workspace packages. Do not replace the lockfile with one from another package manager.

No service or database is required for the existing automated test suite. Work on a real AI provider or database adapter may require credentials or a local service; keep all credentials out of source, fixtures, logs, and committed configuration.

## Repository scripts

Run these commands from the repository root unless noted otherwise.

| Command | What it does |
| --- | --- |
| `npm run build` | Runs each workspace's `build` script. Every current package builds with tsup. |
| `npm run typecheck` | Builds all packages, then runs each workspace's TypeScript check. The build is intentional because packages resolve workspace dependencies through their published package entry points. |
| `npm test` | Runs `test` in workspaces that define it. Currently only `@rophpad/dashu-react` has a test script. |
| `npm run clean` | Removes `packages/*/dist`. |

Useful package-scoped commands include:

```bash
npm run dev --workspace @rophpad/dashu-core
npm run build --workspace @rophpad/dashu-database-postgres
npm run typecheck --workspace @rophpad/dashu-next
npm test --workspace @rophpad/dashu-react
```

Each current package also defines `build:package`, `typecheck:package`, and `prepack`. `dev` runs `tsup --watch`; run it only in the package you are actively changing.

There is currently no repository `lint` or `format` script. Do not report linting or formatting as validated unless such tooling is added and run.

## Package architecture

The workspace contains seven packages:

| Directory | Published package | Responsibility |
| --- | --- | --- |
| `packages/core` | `@rophpad/dashu-core` | Public contracts and the request pipeline: policy, planning, validation, execution, errors, result shaping, and display selection. |
| `packages/database-postgres` | `@rophpad/dashu-database-postgres` | PostgreSQL schema introspection, SQL validation, read-only execution, pooling, and result serialization. |
| `packages/adapter-next` | `@rophpad/dashu-next` | Next.js route handlers that connect host-provided authentication and policy to a `Dashu` instance. |
| `packages/react` | `@rophpad/dashu-react` | React hook, composer, result renderer, charts, theming, and CSV export. |
| `packages/provider-openai-compatible` | `@rophpad/dashu-provider-openai-compatible` | Shared client for OpenAI-compatible chat-completions endpoints, including timeout, retry, token-parameter fallback, and bounded errors. |
| `packages/provider-openrouter` | `@rophpad/dashu-provider-openrouter` | OpenRouter-specific configuration over the OpenAI-compatible provider. |
| `packages/provider-managed` | `@rophpad/dashu-provider-managed` | Managed-service configuration over the OpenAI-compatible provider. |

Dependency direction is deliberate:

```text
                              core
                 ┌─────────────┼──────────────┐
                 │             │              │
        database-postgres  adapter-next     react
                 │
                 └── implements a core interface

                              core
                               ▲
                               │
                  provider-openai-compatible
                         ▲             ▲
                         │             │
                provider-managed  provider-openrouter
```

`core` defines `DashuAiProvider` and `DashuDatabaseAdapter`; it does not import implementations. Keep provider-, database-, framework-, and UI-specific behavior outside `core`. The two specialized providers reuse `provider-openai-compatible` rather than duplicating its HTTP behavior.

The request path is broadly:

1. A framework adapter supplies an authenticated actor and host policy.
2. `core` asks a `DashuAiProvider` for a query plan.
3. A `DashuDatabaseAdapter` validates and executes the SQL.
4. `core` shapes a versioned result contract.
5. The React package can render that contract, but rendering is not required by `core`.

### Build and module boundaries

All packages use `src/index.ts` as their public entry point and tsup to emit ESM, CommonJS, declarations, and source maps under `dist/`. Package manifests expose built files and publish only `dist` plus the package README.

Shared compiler settings live in `tsconfig.packages.json`: strict TypeScript, ES2022, `moduleResolution: "Bundler"`, isolated modules, and no direct TypeScript emit. Workspace path aliases point package imports at source while developing.

Keep relative source imports extensionless, matching the existing code. Import public cross-package APIs by package name rather than reaching into another package's `src` directory.

The React tsup configuration is intentionally different: it disables treeshaking and injects a `"use client"` banner. Preserve that client boundary when changing its build configuration, and keep React external to the bundle.

## Testing

The current automated suite is `packages/react/test/render.test.mjs`. It uses Node's built-in test runner and server-renders imports from `packages/react/dist/index.js`. The package's test script builds first:

```bash
npm test --workspace @rophpad/dashu-react
```

The suite covers all display types, awkward chart data, escaped content, conditional SQL disclosure, component overrides, the composer, standalone components, and CSV serialization. Because it imports `dist`, it also checks the artifact consumers load rather than only source modules.

The root command is:

```bash
npm test
```

npm skips workspaces without a `test` script because the root script uses `--if-present`. Therefore a passing root test currently does **not** mean that core, provider, database, or Next.js behavior has automated coverage.

When changing behavior:

- Add a focused regression test when a suitable suite exists.
- If adding the first test suite to a package, add a `test` script to that package's `package.json`; the root command will discover it automatically.
- Prefer deterministic provider stubs over paid or network-dependent calls.
- Keep unit tests independent of production credentials.
- For adapters, test validation separately from live integration tests so security rules can run quickly and without a database.
- Run `npm run build`, `npm run typecheck`, and `npm test` before submitting a change.

## Adding an AI provider

An AI provider implements `DashuAiProvider` from `packages/core/src/types.ts`:

```ts
type DashuAiProvider = {
  name: string;
  mode: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
};
```

Before creating a package, decide whether the service is OpenAI-compatible. If it is, prefer a thin wrapper around `openAiCompatibleProvider`, as the managed and OpenRouter packages do. This retains the existing cancellation, timeout, retry, token-limit compatibility, usage mapping, and error-redaction behavior.

For a new wire protocol:

1. Create `packages/provider-<name>/` with `src/index.ts`, `package.json`, `tsconfig.json`, `tsup.config.ts`, and `README.md`, following an existing provider package.
2. Implement `complete`, propagate `request.signal`, enforce a bounded timeout, and map the response to `AiCompletionResponse`.
3. Return safe operator-facing errors. Provider responses can echo prompts and schema details, so do not expose unbounded response bodies or credentials.
4. Retry only failures that are genuinely transient. Avoid immediate retry loops for rate limits.
5. Export all supported public types and factories from `src/index.ts`.
6. Add the package to `tsconfig.packages.json` path mappings and run `npm install` so `package-lock.json` records the workspace.
7. Add deterministic tests for successful responses, cancellation, timeout, malformed/empty responses, authentication failures, rate limits, and redaction.
8. Build, typecheck, test, and inspect the packed artifact before release.

Use exact internal dependency versions, consistent with the current manifests, and update those versions together during a release.

## Adding a database adapter

A database adapter implements `DashuDatabaseAdapter` from `packages/core/src/types.ts`:

```ts
interface DashuDatabaseAdapter {
  dialect: string;
  testConnection(): Promise<void>;
  introspect(policy: SchemaPolicy, options?: { force?: boolean }): Promise<DatabaseSchema>;
  renderSchema(schema: DatabaseSchema): string;
  promptRules(): string;
  validate(sql: string, policy: QueryPolicy): ValidatedQuery;
  execute(
    query: ValidatedQuery,
    options: { maxRows: number; timeoutMs: number; signal?: AbortSignal },
  ): Promise<QueryResult>;
}
```

Use `packages/database-postgres` as the reference, but implement rules for the target dialect rather than copying PostgreSQL assumptions.

A production adapter must:

- Introspect only schemas allowed by `SchemaPolicy`, and keep policy boundaries in any schema cache key.
- Render identifiers and dialect instructions consistently so planning and validation agree.
- Reject writes, DDL, dangerous functions, and multiple statements before execution.
- Apply a hard row limit to the executable query.
- Enforce read-only behavior at the database/transaction layer as well as in the SQL guard. String scanning is not an authorization boundary.
- Enforce statement timeouts and propagate cancellation.
- Preserve duplicate result-column names by returning positional `Cell[][]` rows.
- Convert driver-specific values to JSON-safe `Cell` values without silently losing numeric precision.
- Redact passwords, connection strings, SQL-sensitive details, and data from user-facing errors.
- Provide cleanup hooks for pools or clients when the driver keeps process-wide resources.

Add tests for accepted reads and rejected writes, modifying CTEs, DDL, multiple statements, dangerous functions, comments/quoted identifiers, row limits, timeouts, cancellation, duplicate columns, serialization, policy-isolated schema caching, and error redaction. Add live integration tests separately if the adapter needs a real database.

For the package scaffold, follow the provider checklist: add the standard package files, path mapping, lockfile workspace entry, exports, README, scripts, and publish metadata.

## Code conventions

Follow the existing source rather than introducing a second style:

- TypeScript is strict; use `import type` for type-only imports.
- Use two-space indentation, semicolons, double quotes, and trailing commas in multiline structures.
- Prefer exported `type` aliases for data contracts; use an `interface` where an implementation contract benefits from it, as with `DashuDatabaseAdapter`.
- Keep package public APIs explicit in `src/index.ts`. Do not expose internal files through undocumented deep imports.
- Keep package layers narrow and dependency direction toward `core`.
- Preserve cancellation by forwarding `AbortSignal` through framework, provider, and database boundaries.
- Use `DashuError` and its safe message/detail split. A safe message may cross an API boundary; `detail` is operational context and may contain sensitive database or provider information.
- Never include credentials or complete connection strings in errors or logs.
- Add comments for security boundaries, compatibility constraints, and non-obvious tradeoffs—not for code that is already self-explanatory.
- Preserve the versioned result contract. Treat changes to exported types, error behavior, package exports, or result shape as public API changes.
- Avoid adding dependencies when platform APIs or existing workspace code already solve the problem.

## Release cautions

There is no release automation or changeset configuration in this repository. Package versions and exact internal dependency versions are maintained in package manifests and `package-lock.json`; releasing is therefore a deliberate, manual operation.

Before publishing:

1. Decide which packages changed and apply semantic versioning to each public package.
2. Update exact internal dependency ranges in dependent packages. For example, a core release may require coordinated manifest updates in every package that depends on core.
3. Run `npm install` after manifest changes to update `package-lock.json`.
4. Validate the repository:

   ```bash
   npm run clean
   npm run build
   npm run typecheck
   npm test
   npm publish --workspaces --access public --dry-run
   ```

5. Inspect each dry-run file list. Published packages are expected to contain their README and fresh `dist` output; every package's `prepack` runs its build.
6. For higher confidence, run `npm pack --workspace <package-name> --dry-run`, or install a generated tarball in a temporary project outside this workspace to test real package resolution.

Publishing cautions:

- npm versions are immutable. Never try to overwrite a published version; increment it.
- All current packages use `publishConfig.access: "public"` under the `@rophpad` scope. Publishing requires an npm identity authorized for that scope.
- Never commit npm tokens or write them into repository files.
- Check ESM, CommonJS, and declaration entry points when changing `package.json` exports or tsup configuration.
- A package-local `prepack` rebuild does not replace the full workspace validation above.
- Do not publish all workspaces reflexively. Confirm intended package versions, internal dependency versions, and dry-run contents first.
- Coordinate breaking changes to the versioned result contract across core, adapters, and renderers.
