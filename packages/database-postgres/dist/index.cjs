'use strict';

var dns = require('dns');
var pg = require('pg');
var dashuCore = require('@rophpad/dashu-core');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var dns__default = /*#__PURE__*/_interopDefault(dns);
var pg__default = /*#__PURE__*/_interopDefault(pg);

// src/index.ts
var WRITE_STATEMENTS = /* @__PURE__ */ new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "truncate",
  "drop",
  "alter",
  "create",
  "comment",
  "rename",
  "grant",
  "revoke",
  "reassign",
  "security",
  "copy",
  "vacuum",
  "analyze",
  "cluster",
  "reindex",
  "refresh",
  "import",
  "call",
  "do",
  "execute",
  "prepare",
  "deallocate",
  "listen",
  "notify",
  "unlisten",
  "begin",
  "start",
  "commit",
  "rollback",
  "savepoint",
  "release",
  "end",
  "set",
  "reset",
  "discard",
  "lock",
  "checkpoint",
  "load",
  "close",
  "fetch",
  "move"
]);
var BANNED_FUNCTIONS = [
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "lo_import",
  "lo_export",
  "lo_put",
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "dblink",
  "dblink_exec",
  "dblink_connect",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "set_config",
  "pg_logical_emit_message",
  "query_to_xml",
  "pg_execute_server_program"
];
function normalise(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      out += " 'lit' ";
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') {
          i++;
          break;
        } else i++;
      }
      out += " ident ";
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        out += " 'lit' ";
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
function tokenise(sql) {
  return sql.match(/[A-Za-z_][A-Za-z0-9_$]*|'lit'|[^\sA-Za-z0-9_]/g) ?? [];
}
function reject(message) {
  throw new dashuCore.DashuError("QUERY_NOT_ALLOWED", message);
}
function guard(rawSql, policy) {
  const sql = rawSql.trim().replace(/;+\s*$/, "").trim();
  if (!sql) reject("No SQL was produced for that question.");
  const normalised = normalise(sql);
  const tokens = tokenise(normalised);
  if (tokens.includes(";")) {
    reject("Only one statement can be run at a time; multiple were detected.");
  }
  const first = tokens[0]?.toLowerCase();
  if (first !== "select" && first !== "with" && first !== "table" && first !== "(") {
    reject(`Dashu only runs read-only queries. This statement starts with "${first ?? "?"}".`);
  }
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].toLowerCase();
    if (!WRITE_STATEMENTS.has(word)) continue;
    const found = () => reject(`Dashu only runs read-only queries. Found a "${word.toUpperCase()}" statement.`);
    if (i === 0) found();
    if (tokens[i - 1] !== "(") continue;
    if (i === 1) found();
    let j = i - 2;
    while (j >= 0) {
      const back = tokens[j].toLowerCase();
      if (back === "materialized" || back === "not") j--;
      else break;
    }
    if (j >= 0 && tokens[j].toLowerCase() === "as") found();
  }
  const lower = normalised.toLowerCase();
  for (const fn of BANNED_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(lower)) {
      reject(`The function ${fn}() is not permitted.`);
    }
  }
  if (tokens.some((t) => t.toLowerCase() === "into")) {
    reject("SELECT ... INTO is not allowed \u2014 it creates a table.");
  }
  const limit = policy.maxRows;
  const executable = `SELECT * FROM (
${sql}
) AS dashu_result LIMIT ${limit}`;
  return { sql, executable, limit };
}

// src/introspect.ts
var COLUMNS_SQL = `
  SELECT
    n.nspname                                   AS schema,
    c.relname                                   AS table,
    CASE c.relkind WHEN 'v' THEN 'view'
                   WHEN 'm' THEN 'view'
                   ELSE 'table' END             AS kind,
    obj_description(c.oid, 'pg_class')          AS table_comment,
    a.attname                                   AS column,
    format_type(a.atttypid, a.atttypmod)        AS type,
    a.atttypid::text                            AS type_oid,
    NOT a.attnotnull                            AS nullable,
    COALESCE(pk.is_pk, false)                   AS is_primary_key,
    col_description(c.oid, a.attnum)            AS column_comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  LEFT JOIN LATERAL (
    SELECT true AS is_pk
    FROM pg_constraint con
    WHERE con.conrelid = c.oid
      AND con.contype = 'p'
      AND a.attnum = ANY (con.conkey)
    LIMIT 1
  ) pk ON true
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    -- Partition children duplicate their parent's shape. Listing all of them
    -- would bloat the prompt without adding information.
    AND NOT c.relispartition
    AND n.nspname = ANY ($1::text[])
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY n.nspname, c.relname, a.attnum
`;
var FOREIGN_KEYS_SQL = `
  SELECT
    src_ns.nspname  AS from_schema,
    src.relname     AS from_table,
    src_col.attname AS from_column,
    tgt_ns.nspname  AS to_schema,
    tgt.relname     AS to_table,
    tgt_col.attname AS to_column
  FROM pg_constraint con
  JOIN pg_class src        ON src.oid = con.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class tgt        ON tgt.oid = con.confrelid
  JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
  JOIN LATERAL unnest(con.conkey, con.confkey)
       AS cols(src_attnum, tgt_attnum) ON true
  JOIN pg_attribute src_col
       ON src_col.attrelid = src.oid AND src_col.attnum = cols.src_attnum
  JOIN pg_attribute tgt_col
       ON tgt_col.attrelid = tgt.oid AND tgt_col.attnum = cols.tgt_attnum
  WHERE con.contype = 'f'
    AND NOT src.relispartition
    AND NOT tgt.relispartition
    AND src_ns.nspname = ANY ($1::text[])
  ORDER BY src_ns.nspname, src.relname, src_col.attname
`;
var ENUMS_SQL = `
  SELECT t.oid::text AS oid,
         -- The ::text cast is load-bearing. enumlabel is "name", so aggregating
         -- it yields name[] (OID 1003), which node-pg has no array parser for \u2014
         -- it would hand back the raw literal '{a,b}' as a string. text[] is
         -- parsed into a real array.
         array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  GROUP BY t.oid
`;
function toLabels(value) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value !== "string") return [];
  const inner = value.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner) return [];
  const parts = inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? [];
  return parts.map(
    (part) => part.startsWith('"') ? part.slice(1, -1).replace(/\\(.)/g, "$1") : part.trim()
  );
}
var MAX_ENUM_LABELS = 25;
var MAX_COMMENT_CHARS = 160;
function trimComment(value) {
  if (!value) return void 0;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return void 0;
  return clean.length > MAX_COMMENT_CHARS ? `${clean.slice(0, MAX_COMMENT_CHARS).trimEnd()}\u2026` : clean;
}
function buildSchema(columnRows, fkRows, enumRows) {
  const enums = new Map(enumRows.map((row) => [row.oid, toLabels(row.labels)]));
  const byTable = /* @__PURE__ */ new Map();
  for (const row of columnRows) {
    const key = `${row.schema}.${row.table}`;
    let table = byTable.get(key);
    if (!table) {
      table = {
        schema: row.schema,
        name: row.table,
        kind: row.kind,
        columns: [],
        comment: trimComment(row.table_comment)
      };
      byTable.set(key, table);
    }
    const labels = enums.get(row.type_oid);
    const comment = trimComment(row.column_comment);
    table.columns.push({
      name: row.column,
      type: row.type,
      nullable: row.nullable,
      isPrimaryKey: row.is_primary_key,
      ...labels?.length ? { enumValues: labels } : {},
      ...comment ? { comment } : {}
    });
  }
  return {
    tables: [...byTable.values()],
    relationships: fkRows.map((r) => ({
      fromSchema: r.from_schema,
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toSchema: r.to_schema,
      toTable: r.to_table,
      toColumn: r.to_column
    })),
    readAt: Date.now()
  };
}
var RESERVED = /* @__PURE__ */ new Set([
  "all",
  "analyse",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "authorization",
  "binary",
  "both",
  "case",
  "cast",
  "check",
  "collate",
  "collation",
  "column",
  "concurrently",
  "constraint",
  "create",
  "cross",
  "current_catalog",
  "current_date",
  "current_role",
  "current_schema",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "deferrable",
  "desc",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "freeze",
  "from",
  "full",
  "grant",
  "group",
  "having",
  "ilike",
  "in",
  "initially",
  "inner",
  "intersect",
  "into",
  "is",
  "isnull",
  "join",
  "lateral",
  "leading",
  "left",
  "like",
  "limit",
  "localtime",
  "localtimestamp",
  "natural",
  "not",
  "notnull",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "overlaps",
  "placing",
  "primary",
  "references",
  "returning",
  "right",
  "select",
  "session_user",
  "similar",
  "some",
  "symmetric",
  "table",
  "tablesample",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "user",
  "using",
  "variadic",
  "verbose",
  "when",
  "where",
  "window",
  "with"
]);
function quoteIdent(name) {
  const plain = /^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name);
  return plain ? name : `"${name.replace(/"/g, '""')}"`;
}
function qualify(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}
function renderSchema(schema) {
  const lines = [];
  for (const table of schema.tables) {
    lines.push(
      `${table.kind} ${qualify(table.schema, table.name)}` + (table.comment ? `  -- ${table.comment}` : "")
    );
    for (const col of table.columns) {
      const flags = [
        col.isPrimaryKey ? "PK" : null,
        col.nullable ? null : "NOT NULL"
      ].filter(Boolean);
      let line = `  ${quoteIdent(col.name)} ${col.type}`;
      if (flags.length) line += ` [${flags.join(", ")}]`;
      if (Array.isArray(col.enumValues) && col.enumValues.length) {
        const shown = col.enumValues.slice(0, MAX_ENUM_LABELS);
        const suffix = col.enumValues.length > shown.length ? ", \u2026" : "";
        line += ` values: ${shown.map((v) => `'${v}'`).join(", ")}${suffix}`;
      }
      if (col.comment) line += `  -- ${col.comment}`;
      lines.push(line);
    }
  }
  if (schema.relationships.length) {
    lines.push("", "Relationships:");
    for (const fk of schema.relationships) {
      lines.push(
        `  ${qualify(fk.fromSchema, fk.fromTable)}.${quoteIdent(fk.fromColumn)} -> ${qualify(fk.toSchema, fk.toTable)}.${quoteIdent(fk.toColumn)}`
      );
    }
  }
  return lines.join("\n");
}
var PROMPT_RULES = `PostgreSQL rules:
- The statement must be a SELECT; a leading WITH is fine.
- Never write: no INSERT, UPDATE, DELETE, DDL, or data-modifying CTEs. The connection is read-only and will reject them.
- Qualify tables with their schema (e.g. public.orders).
- PostgreSQL folds unquoted names to lower case, so copy quoted identifiers exactly as printed.
- When a column lists \`values:\`, those are the only literals it can hold. Use them exactly; do not invent variants.
- Use date_trunc for grouping over time.`;

// src/index.ts
var { Pool } = pg__default.default;
function configureAddressOrder(preference) {
  if (preference === "auto") return;
  try {
    dns__default.default.setDefaultResultOrder(preference === "6" ? "ipv6first" : "ipv4first");
  } catch {
  }
}
var TRANSIENT = /* @__PURE__ */ new Set(["EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EPIPE"]);
var STATEMENT_TIMEOUT = "57014";
var QUERY_CANCELLED = "57014";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function describeConnectionError(error, host) {
  const code = error?.code;
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
function describeHost(connectionString) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}`;
  } catch {
    return "the database host";
  }
}
var globalForPools = globalThis;
function poolFor(options) {
  globalForPools.dashuPgPools ??= /* @__PURE__ */ new Map();
  const pools = globalForPools.dashuPgPools;
  const existing = pools.get(options.connectionString);
  if (existing) return existing;
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 8,
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 1e4,
    application_name: options.applicationName ?? "dashu"
  });
  pool.on("error", (error) => {
    console.error("[dashu] idle client error", error.message);
  });
  pools.set(options.connectionString, pool);
  return pool;
}
async function closePostgresPools(connectionString) {
  const pools = globalForPools.dashuPgPools;
  if (!pools) return;
  for (const key of connectionString ? [connectionString] : [...pools.keys()]) {
    const pool = pools.get(key);
    pools.delete(key);
    await pool?.end().catch(() => {
    });
  }
}
function serialiseCell(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  return JSON.stringify(value);
}
var globalForSchemas = globalThis;
function schemaCacheKey(connectionString, schemas) {
  return `${connectionString}::${[...schemas].sort().join(",")}`;
}
function invalidateSchemaCache(connectionString) {
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
function postgresAdapter(options) {
  if (!options.connectionString?.trim()) {
    throw new dashuCore.DashuError("DATA_SOURCE_NOT_CONFIGURED", "This data source has no connection string.");
  }
  configureAddressOrder((options.ipFamily ?? "4").trim());
  const connectionString = options.connectionString;
  const host = describeHost(connectionString);
  const defaultSchemas = options.schemas?.length ? options.schemas : ["public"];
  const schemaTtlMs = options.schemaTtlMs ?? 6e4;
  async function connect() {
    const pool = poolFor(options);
    for (let attempt = 0; ; attempt++) {
      try {
        return await pool.connect();
      } catch (error) {
        const code = error.code ?? "";
        if (attempt === 0 && TRANSIENT.has(code)) {
          await sleep(400);
          continue;
        }
        throw new dashuCore.DashuError("QUERY_FAILED", describeConnectionError(error, host), {
          detail: `${code} ${error.message}`,
          cause: error
        });
      }
    }
  }
  async function readOnly(timeoutMs, signal, work) {
    signal?.throwIfAborted();
    const client = await connect();
    const cancel = () => {
      void (async () => {
        const canceller = await connect().catch(() => null);
        if (!canceller) return;
        try {
          await canceller.query("SELECT pg_cancel_backend($1)", [
            client.processID
          ]);
        } catch {
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
      await client.query("ROLLBACK").catch(() => {
      });
      client.release();
    }
  }
  return {
    dialect: "postgresql",
    async testConnection() {
      await readOnly(5e3, void 0, async (client) => {
        await client.query("SELECT 1");
      });
    },
    async introspect(policy, introspectOptions) {
      const schemas = policy.schemas.length ? policy.schemas : defaultSchemas;
      const key = schemaCacheKey(connectionString, schemas);
      globalForSchemas.dashuPgSchemas ??= /* @__PURE__ */ new Map();
      const cache = globalForSchemas.dashuPgSchemas;
      const cached = cache.get(key);
      if (!introspectOptions?.force && cached && Date.now() - cached.schema.readAt < schemaTtlMs) {
        return cached.schema;
      }
      const schema = await readOnly(15e3, void 0, async (client) => {
        const [columns, foreignKeys, enums] = await Promise.all([
          client.query(COLUMNS_SQL, [schemas]),
          client.query(FOREIGN_KEYS_SQL, [schemas]),
          client.query(ENUMS_SQL)
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
    validate(sql, policy) {
      return guard(sql, policy);
    },
    async execute(query, executeOptions) {
      try {
        return await readOnly(executeOptions.timeoutMs, executeOptions.signal, async (client) => {
          const result = await client.query({ text: query.executable, rowMode: "array" });
          return {
            columns: result.fields.map((field) => field.name),
            rows: result.rows.map((row) => row.map(serialiseCell))
          };
        });
      } catch (error) {
        if (error instanceof dashuCore.DashuError) throw error;
        const code = error.code;
        if (code === STATEMENT_TIMEOUT || code === QUERY_CANCELLED) {
          executeOptions.signal?.throwIfAborted();
          throw new dashuCore.DashuError("QUERY_TIMEOUT", "That query took too long and was stopped.", {
            detail: error.message,
            cause: error
          });
        }
        throw new dashuCore.DashuError("QUERY_FAILED", "That query could not be run against this database.", {
          detail: error.message,
          cause: error
        });
      }
    }
  };
}

exports.closePostgresPools = closePostgresPools;
exports.guard = guard;
exports.invalidateSchemaCache = invalidateSchemaCache;
exports.postgresAdapter = postgresAdapter;
exports.quoteIdent = quoteIdent;
exports.renderSchema = renderSchema;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map