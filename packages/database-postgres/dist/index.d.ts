import { QueryPolicy, ValidatedQuery, DatabaseSchema, DashuDatabaseAdapter } from '@rophpad/dashu-core';

/**
 * Validate that a generated statement is a single read-only query, and wrap it
 * so it can never return more than the policy's row limit.
 *
 * This runs *in addition to* the READ ONLY transaction in `execute`, which is
 * the real enforcement boundary, and in addition to the database's own grants,
 * which are the authoritative one. The guard's job is to produce a clear error
 * before we get there — not to be the only thing standing in the way.
 */
declare function guard(rawSql: string, policy: QueryPolicy): ValidatedQuery;

/**
 * Render an identifier the way it must be written in a query.
 *
 * PostgreSQL folds unquoted identifiers to lower case, so a table created as
 * "userProfile" is only reachable as "userProfile" — printing it bare would
 * lead the model straight into `relation does not exist`.
 */
declare function quoteIdent(name: string): string;
/**
 * Render the schema as compact text for the model. Deliberately terse — this is
 * re-sent on every request, so it is the dominant token cost per question.
 */
declare function renderSchema(schema: DatabaseSchema): string;

type PostgresAdapterOptions = {
    connectionString: string;
    /** Schemas to introspect. Defaults to `public`. */
    schemas?: string[];
    /** How long an introspected schema is reused before re-reading the catalog. */
    schemaTtlMs?: number;
    poolMax?: number;
    connectionTimeoutMs?: number;
    applicationName?: string;
    /** "4", "6" or "auto". See `configureAddressOrder`. */
    ipFamily?: string;
};
/** Drain pools created by this package. Used on shutdown and by tests. */
declare function closePostgresPools(connectionString?: string): Promise<void>;
/**
 * Drop cached catalogs. Call this when a connection is repointed or a
 * migration lands, so the model stops being told about a schema that moved.
 */
declare function invalidateSchemaCache(connectionString?: string): void;
declare function postgresAdapter(options: PostgresAdapterOptions): DashuDatabaseAdapter;

export { type PostgresAdapterOptions, closePostgresPools, guard, invalidateSchemaCache, postgresAdapter, quoteIdent, renderSchema };
