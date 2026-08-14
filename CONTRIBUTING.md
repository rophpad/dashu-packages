# Contributing to Dashu

Thank you for helping improve Dashu. This repository contains seven public TypeScript packages managed as npm workspaces.

## Start here

Use Node.js 20 or newer and npm. From the repository root:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Read the [development guide](docs/contributing/development.md) before making a change. It documents the package boundaries, available scripts, current test coverage, provider and database adapter requirements, code conventions, and release cautions.

## Contribution checklist

- Keep the change focused and preserve the dependency direction toward `@rophpad/dashu-core`.
- Add or update tests for behavior changes. Be aware that the current root test command runs tests only for workspaces that define a `test` script; today that is the React package.
- Do not commit API keys, database URLs, npm tokens, customer data, or other secrets.
- Preserve cancellation, policy enforcement, safe error redaction, and read-only database guarantees when working across request boundaries.
- Treat exported types, package entry points, error behavior, and the versioned result contract as public API.
- Run `npm run build`, `npm run typecheck`, and `npm test` before submitting the change.
- Update package documentation when public behavior changes.

There is currently no repository lint or format script. Match the existing TypeScript style and do not claim lint validation that was not run.

## Releases

Do not publish packages as part of an ordinary contribution. Releases require coordinated semantic versions, exact internal dependency updates, lockfile updates, a complete validation pass, and inspection with npm's publish dry run. See [Release cautions](docs/contributing/development.md#release-cautions) for the repository-specific process.
