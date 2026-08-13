import type { DatabaseSchema, SchemaTable } from "@rophpad/dashu-core";

export const COLUMNS_SQL = `
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

export const FOREIGN_KEYS_SQL = `
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

/**
 * Enum labels, keyed by type OID. Without these the model has to guess at
 * literal values — the usual cause of a query that runs and returns nothing.
 */
export const ENUMS_SQL = `
  SELECT t.oid::text AS oid,
         -- The ::text cast is load-bearing. enumlabel is "name", so aggregating
         -- it yields name[] (OID 1003), which node-pg has no array parser for —
         -- it would hand back the raw literal '{a,b}' as a string. text[] is
         -- parsed into a real array.
         array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  GROUP BY t.oid
`;

export type ColumnRow = {
  schema: string;
  table: string;
  kind: "table" | "view";
  table_comment: string | null;
  column: string;
  type: string;
  type_oid: string;
  nullable: boolean;
  is_primary_key: boolean;
  column_comment: string | null;
};

export type ForeignKeyRow = {
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
};

export type EnumRow = { oid: string; labels: unknown };

/**
 * Coerce whatever the driver gave us into labels. The query casts to text[] so
 * this should already be an array, but a pooler or a driver without the array
 * parser can still deliver the literal `{a,b,"c,d"}` — and a string that
 * reaches `renderSchema` breaks it, because `.slice()` on a string succeeds and
 * `.map()` then does not exist.
 */
export function toLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value !== "string") return [];

  const inner = value.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner) return [];

  const parts = inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? [];
  return parts.map((part) =>
    part.startsWith('"') ? part.slice(1, -1).replace(/\\(.)/g, "$1") : part.trim(),
  );
}

/** Keep prompt weight bounded on pathological schemas. */
export const MAX_ENUM_LABELS = 25;
const MAX_COMMENT_CHARS = 160;

function trimComment(value: string | null): string | undefined {
  if (!value) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > MAX_COMMENT_CHARS
    ? `${clean.slice(0, MAX_COMMENT_CHARS).trimEnd()}…`
    : clean;
}

export function buildSchema(
  columnRows: ColumnRow[],
  fkRows: ForeignKeyRow[],
  enumRows: EnumRow[],
): DatabaseSchema {
  const enums = new Map(enumRows.map((row) => [row.oid, toLabels(row.labels)]));
  const byTable = new Map<string, SchemaTable>();

  for (const row of columnRows) {
    const key = `${row.schema}.${row.table}`;
    let table = byTable.get(key);
    if (!table) {
      table = {
        schema: row.schema,
        name: row.table,
        kind: row.kind,
        columns: [],
        comment: trimComment(row.table_comment),
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
      ...(labels?.length ? { enumValues: labels } : {}),
      ...(comment ? { comment } : {}),
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
      toColumn: r.to_column,
    })),
    readAt: Date.now(),
  };
}

/**
 * Reserved words that must be quoted to be used as identifiers. Not exhaustive
 * — it covers the words that realistically appear as table or column names.
 */
const RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
  "authorization", "binary", "both", "case", "cast", "check", "collate",
  "collation", "column", "concurrently", "constraint", "create", "cross",
  "current_catalog", "current_date", "current_role", "current_schema",
  "current_time", "current_timestamp", "current_user", "default", "deferrable",
  "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for",
  "foreign", "freeze", "from", "full", "grant", "group", "having", "ilike", "in",
  "initially", "inner", "intersect", "into", "is", "isnull", "join", "lateral",
  "leading", "left", "like", "limit", "localtime", "localtimestamp", "natural",
  "not", "notnull", "null", "offset", "on", "only", "or", "order", "outer",
  "overlaps", "placing", "primary", "references", "returning", "right", "select",
  "session_user", "similar", "some", "symmetric", "table", "tablesample", "then",
  "to", "trailing", "true", "union", "unique", "user", "using", "variadic",
  "verbose", "when", "where", "window", "with",
]);

/**
 * Render an identifier the way it must be written in a query.
 *
 * PostgreSQL folds unquoted identifiers to lower case, so a table created as
 * "userProfile" is only reachable as "userProfile" — printing it bare would
 * lead the model straight into `relation does not exist`.
 */
export function quoteIdent(name: string): string {
  const plain = /^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name);
  return plain ? name : `"${name.replace(/"/g, '""')}"`;
}

function qualify(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

/**
 * Render the schema as compact text for the model. Deliberately terse — this is
 * re-sent on every request, so it is the dominant token cost per question.
 */
export function renderSchema(schema: DatabaseSchema): string {
  const lines: string[] = [];

  for (const table of schema.tables) {
    lines.push(
      `${table.kind} ${qualify(table.schema, table.name)}` +
        (table.comment ? `  -- ${table.comment}` : ""),
    );

    for (const col of table.columns) {
      const flags = [
        col.isPrimaryKey ? "PK" : null,
        col.nullable ? null : "NOT NULL",
      ].filter(Boolean);

      let line = `  ${quoteIdent(col.name)} ${col.type}`;
      if (flags.length) line += ` [${flags.join(", ")}]`;

      if (Array.isArray(col.enumValues) && col.enumValues.length) {
        const shown = col.enumValues.slice(0, MAX_ENUM_LABELS);
        const suffix = col.enumValues.length > shown.length ? ", …" : "";
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
        `  ${qualify(fk.fromSchema, fk.fromTable)}.${quoteIdent(fk.fromColumn)}` +
          ` -> ${qualify(fk.toSchema, fk.toTable)}.${quoteIdent(fk.toColumn)}`,
      );
    }
  }

  return lines.join("\n");
}

export const PROMPT_RULES = `PostgreSQL rules:
- The statement must be a SELECT; a leading WITH is fine.
- Never write: no INSERT, UPDATE, DELETE, DDL, or data-modifying CTEs. The connection is read-only and will reject them.
- Qualify tables with their schema (e.g. public.orders).
- PostgreSQL folds unquoted names to lower case, so copy quoted identifiers exactly as printed.
- When a column lists \`values:\`, those are the only literals it can hold. Use them exactly; do not invent variants.
- Use date_trunc for grouping over time.`;
