# @rophpad/dashu-database-postgres

PostgreSQL adapter for Dashu: catalog introspection, schema rendering, SQL validation, pooling, cancellation, and read-only execution.

## Install

```bash
npm install @rophpad/dashu-core @rophpad/dashu-database-postgres
```

Requires a Node.js backend. Do not use this adapter in a browser or Edge runtime.

## Usage

```ts
import { postgresAdapter } from "@rophpad/dashu-database-postgres";

const database = postgresAdapter({
  connectionString: process.env.DASHU_DATABASE_URL!,
  schemas: ["analytics"],
  schemaTtlMs: 60_000,
  poolMax: 8,
  connectionTimeoutMs: 10_000,
  applicationName: "my-product-dashu",
  ipFamily: "4",
});
```

Use a dedicated PostgreSQL role with only `CONNECT`, approved schema `USAGE`, and approved object `SELECT`. The adapter's guard and read-only transaction are defense in depth; database grants remain authoritative.

Also exported: `closePostgresPools`, `invalidateSchemaCache`, `guard`, `quoteIdent`, and `renderSchema`.

## Documentation

- [PostgreSQL API reference](https://github.com/rophpad/dashu/blob/main/docs/reference/packages.md#rophpaddashu-database-postgres)
- [Read-only role and security](https://github.com/rophpad/dashu/blob/main/docs/security/security-model.md)
- [Operations, pooling, and cache](https://github.com/rophpad/dashu/blob/main/docs/guides/operations-and-troubleshooting.md)

## License

Apache-2.0
