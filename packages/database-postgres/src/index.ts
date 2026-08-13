import dns from "node:dns";
import pg from "pg";
import {
  DashuError,
  type DashuDatabaseAdapter,
  type Cell,
  type DatabaseSchema,
  type QueryPolicy,
  type QueryResult,
  type SchemaPolicy,
  type ValidatedQuery,
} from "@rophpad/dashu-core";
import { guard } from "./guard";
import {
  buildSchema,
  COLUMNS_SQL,
  ENUMS_SQL,
  FOREIGN_KEYS_SQL,
  PROMPT_RULES,
  renderSchema,
  type ColumnRow,
  type EnumRow,
  type ForeignKeyRow,
} from "./introspect";

const { Pool } = pg;
type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

/**
 * Prefer IPv4 when resolving database hosts.
 *
 * Managed providers (Neon, Supabase, RDS) publish both A and AAAA records, but
 * Docker's default bridge network has no IPv6 route. Node's default ordering
 * hands back the AAAA first, the SYN goes nowhere, and the connection dies with
 * ETIMEDOUT after the full timeout — while the host resolves and connects fine.
 *
 * `ipv4first` only changes the *order*: Happy Eyeballs still falls back to
 * IPv6, so genuinely IPv6-only networks keep working.
 */
function configureAddressOrder(preference: string): void {
  if (preference === "auto") return;
  try {
    dns.setDefaultResultOrder(preference === "6" ? "ipv6first" : "ipv4first");
  } catch {
    // Older Node without this ordering — the default is then whatever it is.
  }
}

export type PostgresAdapterOptions = {
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

/** Worth one automatic retry — these say "try again", not "you're wrong". */
const TRANSIENT = new Set(["EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EPIPE"]);

/** Postgres raises this when `statement_timeout` fires. */
const STATEMENT_TIMEOUT = "57014";
const QUERY_CANCELLED = "57014";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turn driver and libpq errors into something that tells an operator what to
 * do. `getaddrinfo EAI_AGAIN <host>` is accurate and useless.
 *
 * The host is described as `host:port` and never carries credentials — the
 * password is in the same connection string, so interpolating the whole URL
 * here is how connection secrets end up in an HTTP response.
 */
function describeConnectionError(error: unknown, host: string): string {
  const code = (error as NodeJS.ErrnoException)?.code;

  switch (code) {
    case "EAI_AGAIN":
      return `Temporary DNS failure looking up ${host}. This usually clears on its own.`;
    case "ENOTFOUND":
      return `No such host: ${host}. Check the hostname for typos.`;
    case "ECONNREFUSED":
      return `Nothing accepted a connection at ${host}. Check the port, and remember that inside Docker "localhost" is the container.`;
    case "ETIMEDOUT":
      return `Timed out connecting to ${host}. Usual causes: a firewall or IP allow-list, or an IPv6 address this host cannot route to.`;
    case "ECONNRESET":
      return `The connection to ${host} was reset. If the server requires TLS, add ?sslmode=require to the connection string.`;
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `The TLS certificate for ${host} could not be verified.`;
    case "28P01":
      return "Password authentication failed for the analytics role.";
    case "28000":
      return "The server rejected the analytics role.";
    case "3D000":
      return "That database does not exist on the server.";
    case "42501":
      return "Permission denied. The analytics role needs CONNECT, plus USAGE and SELECT on the approved schemas.";
    case "53300":
      return "The server has too many clients already.";
    default:
      return `Could not reach the database at ${host}.`;
  }
}

/** `user@host:port/database` is safe to show; the password is not. */
function describeHost(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}`;
  } catch {
    return "the database host";
  }
}

/**
 * Pools keyed by connection string.
 *
 * Keyed rather than "current", which is what makes this safe under
 * concurrency: two requests against different data sources get different
 * pools, and neither can be repointed by the other.
 */
const globalForPools = globalThis as unknown as { dashuPgPools?: Map<string, Pool> };

function poolFor(options: Required<Pick<PostgresAdapterOptions, "connectionString">> & PostgresAdapterOptions): Pool {
  globalForPools.dashuPgPools ??= new Map();
  const pools = globalForPools.dashuPgPools;

  const existing = pools.get(options.connectionString);
  if (existing) return existing;

  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    application_name: options.applicationName ?? "dashu",
  });

  pool.on("error", (error) => {
    console.error("[dashu] idle client error", (error as Error).message);
  });

  pools.set(options.connectionString, pool);
  return pool;
}

/** Drain pools created by this package. Used on shutdown and by tests. */
export async function closePostgresPools(connectionString?: string): Promise<void> {
  const pools = globalForPools.dashuPgPools;
  if (!pools) return;

  for (const key of connectionString ? [connectionString] : [...pools.keys()]) {
    const pool = pools.get(key);
    pools.delete(key);
    await pool?.end().catch(() => {});
  }
}

/**
 * PostgreSQL returns dates, numerics and buffers as objects; make them
 * JSON-safe without losing precision. Numerics stay strings deliberately —
 * `Number()` on a wide numeric silently rounds.
 */
function serialiseCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  return JSON.stringify(value);
}

type SchemaCacheEntry = { schema: DatabaseSchema; key: string };
const globalForSchemas = globalThis as unknown as {
  dashuPgSchemas?: Map<string, SchemaCacheEntry>;
};

/**
 * Cached per connection *and* policy. Two tenants sharing a connection but
 * approved for different schemas must not be able to read each other's cached
 * catalog — the policy is part of the key precisely so they cannot.
 */
function schemaCacheKey(connectionString: string, schemas: string[]): string {
  return `${connectionString}::${[...schemas].sort().join(",")}`;
}

/**
 * Drop cached catalogs. Call this when a connection is repointed or a
 * migration lands, so the model stops being told about a schema that moved.
 */
export function invalidateSchemaCache(connectionString?: string): void {
  const cache = globalForSchemas.dashuPgSchemas;
  if (!cache) return;

  if (!connectionString) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${connectionString}::`)) cache.delete(key);
  }
}

export function postgresAdapter(options: PostgresAdapterOptions): DashuDatabaseAdapter {
  if (!options.connectionString?.trim()) {
    throw new DashuError("DATA_SOURCE_NOT_CONFIGURED", "This data source has no connection string.");
  }

  configureAddressOrder((options.ipFamily ?? "4").trim());

  const connectionString = options.connectionString;
  const host = describeHost(connectionString);
  const defaultSchemas = options.schemas?.length ? options.schemas : ["public"];
  const schemaTtlMs = options.schemaTtlMs ?? 60_000;

  /**
   * Acquire a client, retrying once on the errors that are genuinely
   * transient. Serverless providers sit behind DNS that occasionally stalls,
   * and a single retry turns a failed question into a slightly slower one.
   */
  async function connect(): Promise<PoolClient> {
    const pool = poolFor(options);

    for (let attempt = 0; ; attempt++) {
      try {
        return await pool.connect();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt === 0 && TRANSIENT.has(code)) {
          await sleep(400);
          continue;
        }
        throw new DashuError("QUERY_FAILED", describeConnectionError(error, host), {
          detail: `${code} ${(error as Error).message}`,
          cause: error,
        });
      }
    }
  }

  /**
   * Run inside a READ ONLY transaction with a statement timeout.
   *
   * This is the enforcement boundary that matters after the database's own
   * grants: even if the guard were bypassed, PostgreSQL rejects any write
   * inside a read-only transaction.
   */
  async function readOnly<T>(
    timeoutMs: number,
    signal: AbortSignal | undefined,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    const client = await connect();

    // A disconnected browser should not leave a query running for the full
    // statement timeout. pg_cancel_backend on this client's own PID is the
    // only way to reach an in-flight query from outside it.
    const cancel = () => {
      void (async () => {
        const canceller = await connect().catch(() => null);
        if (!canceller) return;
        try {
          await canceller.query("SELECT pg_cancel_backend($1)", [
            (client as unknown as { processID?: number }).processID,
          ]);
        } catch {
          // The query may already have finished; nothing to cancel.
        } finally {
          canceller.release();
        }
      })();
    };

    signal?.addEventListener("abort", cancel, { once: true });

    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
      return await work(client);
    } finally {
      signal?.removeEventListener("abort", cancel);
      // The transaction is read-only, so rolling back is always the right call.
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  return {
    dialect: "postgresql",

    async testConnection() {
      await readOnly(5_000, undefined, async (client) => {
        await client.query("SELECT 1");
      });
    },

    async introspect(policy: SchemaPolicy, introspectOptions): Promise<DatabaseSchema> {
      const schemas = policy.schemas.length ? policy.schemas : defaultSchemas;
      const key = schemaCacheKey(connectionString, schemas);

      globalForSchemas.dashuPgSchemas ??= new Map();
      const cache = globalForSchemas.dashuPgSchemas;
      const cached = cache.get(key);

      if (!introspectOptions?.force && cached && Date.now() - cached.schema.readAt < schemaTtlMs) {
        return cached.schema;
      }

      const schema = await readOnly(15_000, undefined, async (client) => {
        const [columns, foreignKeys, enums] = await Promise.all([
          client.query<ColumnRow>(COLUMNS_SQL, [schemas]),
          client.query<ForeignKeyRow>(FOREIGN_KEYS_SQL, [schemas]),
          client.query<EnumRow>(ENUMS_SQL),
        ]);
        return buildSchema(columns.rows, foreignKeys.rows, enums.rows);
      });

      cache.set(key, { schema, key });
      return schema;
    },

    renderSchema,

    promptRules() {
      return PROMPT_RULES;
    },

    validate(sql: string, policy: QueryPolicy): ValidatedQuery {
      return guard(sql, policy);
    },

    async execute(query, executeOptions): Promise<QueryResult> {
      try {
        return await readOnly(executeOptions.timeoutMs, executeOptions.signal, async (client) => {
          // `rowMode: "array"` is load-bearing, not a style choice. node-pg's
          // default builds each row as an object keyed by column name, so a
          // result with two columns of the same name collapses to one key and
          // silently reports one value twice. Positional rows keep duplicates
          // distinct; core re-keys them with unique names.
          const result = await client.query({ text: query.executable, rowMode: "array" });

          return {
            columns: result.fields.map((field) => field.name),
            rows: (result.rows as unknown as unknown[][]).map((row) => row.map(serialiseCell)),
          };
        });
      } catch (error) {
        if (error instanceof DashuError) throw error;

        const code = (error as { code?: string }).code;
        if (code === STATEMENT_TIMEOUT || code === QUERY_CANCELLED) {
          executeOptions.signal?.throwIfAborted();
          throw new DashuError("QUERY_TIMEOUT", "That query took too long and was stopped.", {
            detail: (error as Error).message,
            cause: error,
          });
        }

        // Anything else is most likely a query the model got wrong. The driver
        // message is genuinely useful for the one repair attempt, so it rides
        // on `detail` — which core feeds back to the model and never returns to
        // the browser, because it can quote table names and literal values.
        throw new DashuError("QUERY_FAILED", "That query could not be run against this database.", {
          detail: (error as Error).message,
          cause: error,
        });
      }
    },
  };
}

export { guard } from "./guard";
export { quoteIdent, renderSchema } from "./introspect";
