import { DashuError, type QueryPolicy, type ValidatedQuery } from "@rophpad/dashu-core";

/**
 * Statements that write. PostgreSQL allows data-modifying statements inside
 * CTEs (`WITH x AS (INSERT ...) SELECT ...`), so a query that *starts* with
 * SELECT or WITH is not automatically read-only.
 *
 * These are only rejected in statement position — at the very start, or
 * directly after an opening paren. Checking them everywhere would reject
 * perfectly ordinary queries against columns named `comment`, `set`, `copy` or
 * `analyze`.
 */
const WRITE_STATEMENTS = new Set([
  "insert", "update", "delete", "merge", "truncate",
  "drop", "alter", "create", "comment", "rename",
  "grant", "revoke", "reassign", "security",
  "copy", "vacuum", "analyze", "cluster", "reindex", "refresh", "import",
  "call", "do", "execute", "prepare", "deallocate", "listen", "notify", "unlisten",
  "begin", "start", "commit", "rollback", "savepoint", "release", "end",
  "set", "reset", "discard", "lock", "checkpoint", "load", "close", "fetch", "move",
]);

/**
 * Functions that read the filesystem, open network connections, stall a
 * connection, or mutate server state. Banned wherever they appear — none of
 * these are plausible column names.
 */
const BANNED_FUNCTIONS = [
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file",
  "lo_import", "lo_export", "lo_put",
  "pg_sleep", "pg_sleep_for", "pg_sleep_until",
  "dblink", "dblink_exec", "dblink_connect",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
  "set_config", "pg_logical_emit_message",
  "query_to_xml", "pg_execute_server_program",
];

/**
 * Replace comments, string literals and quoted identifiers with placeholders so
 * the remainder can be scanned for keywords without tripping over user data.
 */
function normalise(sql: string): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: -- ... end of line
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }

    // Block comment: /* ... */ — PostgreSQL allows these to nest
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      out += " ";
      continue;
    }

    // Single-quoted string; '' escapes an embedded quote
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") { i++; break; }
        else i++;
      }
      out += " 'lit' ";
      continue;
    }

    // Double-quoted identifier — kept as an opaque token, never a keyword
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') { i++; break; }
        else i++;
      }
      out += " ident ";
      continue;
    }

    // Dollar-quoted string: $tag$ ... $tag$
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

/** Split into words and single punctuation characters, dropping whitespace. */
function tokenise(sql: string): string[] {
  return sql.match(/[A-Za-z_][A-Za-z0-9_$]*|'lit'|[^\sA-Za-z0-9_]/g) ?? [];
}

function reject(message: string): never {
  throw new DashuError("QUERY_NOT_ALLOWED", message);
}

/**
 * Validate that a generated statement is a single read-only query, and wrap it
 * so it can never return more than the policy's row limit.
 *
 * This runs *in addition to* the READ ONLY transaction in `execute`, which is
 * the real enforcement boundary, and in addition to the database's own grants,
 * which are the authoritative one. The guard's job is to produce a clear error
 * before we get there — not to be the only thing standing in the way.
 */
export function guard(rawSql: string, policy: QueryPolicy): ValidatedQuery {
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

  // Where a write statement can actually appear.
  //
  // PostgreSQL only permits data-modifying statements in two places: at the top
  // level, and as the body of a CTE — `WITH x AS (DELETE ...)`. It is a syntax
  // error anywhere else, so `SELECT * FROM (DELETE ...)` cannot happen.
  //
  // Matching that shape rather than "any token after `(`" is what keeps
  // ordinary queries working: an earlier version treated every opening paren as
  // a statement boundary and rejected `SELECT count(comment) FROM posts`,
  // because `comment` is also a DDL keyword.
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].toLowerCase();
    if (!WRITE_STATEMENTS.has(word)) continue;

    const found = () =>
      reject(`Dashu only runs read-only queries. Found a "${word.toUpperCase()}" statement.`);

    if (i === 0) found();
    if (tokens[i - 1] !== "(") continue;

    // A paren opening the whole statement, e.g. `(INSERT ...)`.
    if (i === 1) found();

    // CTE body: `name AS (`, optionally `AS MATERIALIZED (` / `AS NOT MATERIALIZED (`.
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

  // `SELECT ... INTO new_table` creates a table. INTO is a reserved word, so an
  // unquoted occurrence is always the real clause.
  if (tokens.some((t) => t.toLowerCase() === "into")) {
    reject("SELECT ... INTO is not allowed — it creates a table.");
  }

  // Wrapping rather than appending a LIMIT: this survives UNION, ORDER BY, an
  // existing LIMIT and trailing CTEs without having to parse any of them.
  const limit = policy.maxRows;
  const executable = `SELECT * FROM (\n${sql}\n) AS dashu_result LIMIT ${limit}`;

  return { sql, executable, limit };
}
