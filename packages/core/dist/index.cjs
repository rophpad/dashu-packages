'use strict';

// src/types.ts
var PERMISSIONS = {
  ask: "dashu:ask",
  viewSchema: "dashu:view-schema",
  viewSql: "dashu:view-sql",
  export: "dashu:export",
  saveDashboard: "dashu:save-dashboard"
};

// src/errors.ts
var STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  AI_NOT_CONFIGURED: 409,
  AI_UNAVAILABLE: 502,
  DATA_SOURCE_NOT_CONFIGURED: 409,
  SCHEMA_UNAVAILABLE: 409,
  QUERY_NOT_ALLOWED: 400,
  QUERY_TIMEOUT: 504,
  QUERY_FAILED: 400,
  RESULT_LIMIT_EXCEEDED: 400,
  CANCELLED: 499,
  INTERNAL: 500
};
var DashuError = class _DashuError extends Error {
  code;
  status;
  requestId;
  /**
   * Extra context for the server log only. Never serialised into a response —
   * this is where a driver message or a provider status ends up.
   */
  detail;
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "DashuError";
    this.code = code;
    this.status = STATUS[code];
    this.requestId = options.requestId;
    this.detail = options.detail;
  }
  withRequestId(requestId) {
    if (this.requestId) return this;
    return new _DashuError(this.code, this.message, {
      requestId,
      detail: this.detail,
      cause: this.cause
    });
  }
};
function toErrorResponse(error, requestId) {
  if (error instanceof DashuError) {
    return {
      error: { code: error.code, message: error.message, requestId }
    };
  }
  return {
    error: {
      code: "INTERNAL",
      message: "Something went wrong handling that question.",
      requestId
    }
  };
}
function errorStatus(error) {
  return error instanceof DashuError ? error.status : 500;
}

// src/json.ts
function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
    }
  }
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index++) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth++;
      else if (character === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new DashuError("AI_UNAVAILABLE", "The model did not return a usable query plan.", {
    detail: `unparseable completion, ${trimmed.length} chars`
  });
}

// src/planning.ts
var DISPLAY_TYPES = /* @__PURE__ */ new Set([
  "table",
  "metric",
  "bar-chart",
  "line-chart",
  "area-chart",
  "pie-chart",
  "scatter-chart"
]);
var BASE_INSTRUCTIONS = `You are Dashu, a query layer that turns questions into a single read-only SQL query.

Rules that apply to every dialect:
- Emit exactly one statement, and it must only read.
- Use only the tables and columns listed in the schema below. Never invent one.
- Identifiers are printed exactly as they must be written, including quotes. Copy them verbatim.
- Lines beginning with -- describe the table or column. Use them to resolve ambiguity.
- Join using the listed relationships rather than guessing at key names.
- Prefer explicit column lists over SELECT * so results stay readable.
- Add an ORDER BY for anything ranked, and a LIMIT for "top N" questions.
- Give aggregates readable aliases (revenue, order_count) rather than leaving sum(...) as the column name.
- Results are capped at a fixed row limit regardless of what you write.

Response format \u2014 this matters:
Reply with a single raw JSON object and nothing else. No prose before or after it, no markdown fences, no reasoning. The object has exactly these keys:

{
  "sql": "<one read-only statement, or an empty string if the question cannot be answered>",
  "explanation": "<one plain sentence describing what the result shows>",
  "display": {
    "type": "table" | "metric" | "bar-chart" | "line-chart" | "area-chart" | "pie-chart" | "scatter-chart",
    "title": "<a short title for the result>",
    "x": "<a column you selected, or an empty string>",
    "y": "<a column you selected, or an empty string>"
  }
}

Field guidance:
- "explanation" is for someone who will not read the SQL. No SQL jargon, no restating the question.
- "display": pick the type that matches the shape of the answer.
    "metric"        a single number
    "bar-chart"     rankings and comparisons between categories
    "line-chart"    a measure over time
    "area-chart"    a running total or volume over time, where the filled magnitude matters
    "pie-chart"     parts of a single whole \u2014 2 to 8 categories, no negatives
    "scatter-chart" the relationship between two numeric columns; "x" is the x axis and must itself be numeric
    "table"         wide results, or anything with more than about 30 rows
  "x" and "y" must name columns exactly as you aliased them in the SELECT \u2014 a name that is not in the result means the chart is dropped and a table is shown instead. Use empty strings for "table". Prefer a bar chart over a pie chart whenever the question is about ranking rather than composition.
- If the question cannot be answered from this schema, set "sql" to an empty string and use "explanation" to say what is missing. Do not guess at tables that are not there.`;
function asString(value, maxLength = 400) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}
function asDisplayType(value) {
  return typeof value === "string" && DISPLAY_TYPES.has(value) ? value : "table";
}
function semanticToPrompt(layer) {
  if (!layer) return "";
  const lines = [];
  const terms = Object.entries(layer.terms ?? {});
  if (terms.length) {
    lines.push("Business vocabulary:");
    for (const [term, meaning] of terms) lines.push(`  "${term}" means ${meaning}`);
  }
  if (layer.notes?.length) {
    if (lines.length) lines.push("");
    lines.push("Notes about this database:");
    for (const note of layer.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}
async function planQuery(provider, request) {
  const system = [
    BASE_INSTRUCTIONS,
    request.dialectRules,
    `Database schema:

${request.schemaPrompt}`,
    semanticToPrompt(request.semantic)
  ].filter(Boolean).join("\n\n---\n\n");
  const messages = [{ role: "system", content: system }];
  for (const turn of request.history ?? []) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: `Previous query:
${turn.sql}` });
  }
  if (request.repair) {
    messages.push({
      role: "user",
      content: `${request.question}

Your previous attempt failed. Rewrite it so it runs.

Query:
${request.repair.sql}

Database error:
${request.repair.error}

Reply with the same raw JSON object as before.`
    });
  } else {
    messages.push({ role: "user", content: request.question });
  }
  const completion = await provider.complete({
    messages,
    maxOutputTokens: request.maxOutputTokens,
    signal: request.signal
  });
  const parsed = extractJson(completion.content);
  return {
    sql: asString(parsed.sql, 2e4),
    explanation: asString(parsed.explanation, 600),
    display: {
      type: asDisplayType(parsed.display?.type),
      title: asString(parsed.display?.title, 120) || void 0,
      x: asString(parsed.display?.x, 200) || void 0,
      y: asString(parsed.display?.y, 200) || void 0
    }
  };
}

// src/policy.ts
var POLICY_DEFAULTS = {
  schemas: [],
  denyTables: [],
  denyColumns: [],
  maxRows: 200,
  statementTimeoutMs: 1e4,
  exposeSql: false,
  allowExport: false,
  allowSaveDashboard: false
};
var MAX_ROWS_CEILING = 1e4;
var MAX_TIMEOUT_MS = 12e4;
function positive(value, fallback, ceiling) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), ceiling);
}
function names(value) {
  if (!Array.isArray(value)) return [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of value) {
    const name = String(entry ?? "").trim();
    if (name) seen.add(name);
  }
  return [...seen];
}
function resolvePolicy(defaults, request) {
  const base = { ...POLICY_DEFAULTS, ...defaults };
  const input = request ?? {};
  return {
    schemas: input.schemas ? names(input.schemas) : names(base.schemas),
    denyTables: [...names(base.denyTables), ...names(input.denyTables)],
    denyColumns: [...names(base.denyColumns), ...names(input.denyColumns)],
    maxRows: positive(input.maxRows ?? base.maxRows, POLICY_DEFAULTS.maxRows, MAX_ROWS_CEILING),
    statementTimeoutMs: positive(
      input.statementTimeoutMs ?? base.statementTimeoutMs,
      POLICY_DEFAULTS.statementTimeoutMs,
      MAX_TIMEOUT_MS
    ),
    exposeSql: Boolean(base.exposeSql) && input.exposeSql !== false,
    allowExport: Boolean(base.allowExport) && input.allowExport !== false,
    allowSaveDashboard: Boolean(base.allowSaveDashboard) && input.allowSaveDashboard !== false
  };
}
function hasPermission(actor, permission) {
  const alias = permission.startsWith("dashu:") ? `askdb:${permission.slice("dashu:".length)}` : permission.startsWith("askdb:") ? `dashu:${permission.slice("askdb:".length)}` : permission;
  return actor.permissions.includes(permission) || actor.permissions.includes(alias);
}
function policyForActor(actor) {
  return {
    exposeSql: hasPermission(actor, PERMISSIONS.viewSql),
    allowExport: hasPermission(actor, PERMISSIONS.export),
    allowSaveDashboard: hasPermission(actor, PERMISSIONS.saveDashboard)
  };
}
function requirePermission(actor, permission) {
  if (!hasPermission(actor, permission)) {
    throw new DashuError("FORBIDDEN", "You do not have permission to do that.", {
      detail: `actor ${actor.id} lacks ${permission}`
    });
  }
}
function matches(patterns, qualified) {
  const lower = qualified.toLowerCase();
  return patterns.some((pattern) => pattern.toLowerCase() === lower);
}
function applySchemaPolicy(schema, policy) {
  if (!policy.denyTables.length && !policy.denyColumns.length) return schema;
  const tables = schema.tables.filter((table) => !matches(policy.denyTables, `${table.schema}.${table.name}`)).map((table) => ({
    ...table,
    columns: table.columns.filter(
      (column) => !matches(policy.denyColumns, `${table.schema}.${table.name}.${column.name}`) && !matches(policy.denyColumns, `${table.name}.${column.name}`)
    )
  })).filter((table) => table.columns.length > 0);
  const visible = new Set(tables.map((table) => `${table.schema}.${table.name}`));
  return {
    ...schema,
    tables,
    // A relationship pointing at a hidden table would disclose its name.
    relationships: schema.relationships.filter(
      (link) => visible.has(`${link.fromSchema}.${link.fromTable}`) && visible.has(`${link.toSchema}.${link.toTable}`)
    )
  };
}

// src/display-spec.ts
var MAX_TITLE = 120;
var MAX_CHART_ROWS = 60;
var CHART_TYPES = /* @__PURE__ */ new Set([
  "bar-chart",
  "line-chart",
  "area-chart",
  "pie-chart",
  "scatter-chart"
]);
function cleanTitle(title) {
  if (typeof title !== "string") return void 0;
  const clean = title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return void 0;
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE).trimEnd()}\u2026` : clean;
}
function numericValues(data, key) {
  return data.rows.map((row) => {
    const value = row[key];
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }).filter((value) => value !== null);
}
function isNumeric(data, key) {
  const column = data.columns.find((c) => c.key === key);
  if (!column) return false;
  if (column.type === "number") return true;
  return column.type === "unknown" && numericValues(data, key).length >= 2;
}
function supported(data, x, y) {
  if (data.rows.length < 2 || data.rows.length > MAX_CHART_ROWS) return [];
  if (!data.columns.some((c) => c.key === x)) return [];
  if (!isNumeric(data, y)) return [];
  const types = ["bar-chart", "line-chart", "area-chart"];
  const values = numericValues(data, y);
  if (values.length === data.rows.length && values.every((v) => v >= 0) && values.some((v) => v > 0)) {
    types.push("pie-chart");
  }
  if (isNumeric(data, x)) types.push("scatter-chart");
  return types;
}
function resolveKey(data, name) {
  if (!name) return void 0;
  if (data.columns.some((column) => column.key === name)) return name;
  return data.columns.find((column) => column.label === name)?.key;
}
function resolveDisplay(suggestion, data) {
  const title = cleanTitle(suggestion.title);
  const table = { type: "table", ...title ? { title } : {} };
  if (!data.columns.length || !data.rows.length) return { primary: table, alternatives: [] };
  if (suggestion.type === "metric") {
    const key = resolveKey(data, suggestion.y) ?? data.columns[0].key;
    if (data.rows.length === 1 && isNumeric(data, key)) {
      return {
        primary: { type: "metric", y: key, ...title ? { title } : {} },
        alternatives: [{ type: "table" }]
      };
    }
    return { primary: table, alternatives: [] };
  }
  if (!CHART_TYPES.has(suggestion.type)) return { primary: table, alternatives: [] };
  const x = resolveKey(data, suggestion.x);
  const y = resolveKey(data, suggestion.y);
  if (!x || !y) return { primary: table, alternatives: [] };
  const available = supported(data, x, y);
  if (!available.length) return { primary: table, alternatives: [] };
  const type = available.includes(suggestion.type) ? suggestion.type : "bar-chart";
  return {
    primary: { type, x, y, ...title ? { title } : {} },
    alternatives: [
      ...available.filter((other) => other !== type).map((other) => ({ type: other, x, y })),
      { type: "table" }
    ]
  };
}

// src/result.ts
function uniqueKeys(columns) {
  const used = /* @__PURE__ */ new Map();
  return columns.map((name, index) => {
    const base = name || `column_${index + 1}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}_${seen + 1}`;
  });
}
var ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
var NUMERIC = /^-?\d+(\.\d+)?$/;
function inferType(values) {
  let seen = false;
  let numeric = true;
  let date = true;
  let boolean = true;
  for (const value of values) {
    if (value === null) continue;
    seen = true;
    if (typeof value === "number") {
      date = false;
      boolean = false;
      continue;
    }
    if (typeof value === "boolean") {
      numeric = false;
      date = false;
      continue;
    }
    if (typeof value === "string") {
      boolean = false;
      if (!NUMERIC.test(value)) numeric = false;
      if (!ISO_DATE.test(value)) date = false;
      continue;
    }
    return "unknown";
  }
  if (!seen) return "unknown";
  if (boolean) return "boolean";
  if (date) return "date";
  if (numeric) return "number";
  return "string";
}
var TYPE_SAMPLE = 50;
function toResultData(result, limit) {
  const keys = uniqueKeys(result.columns);
  const sample = result.rows.slice(0, TYPE_SAMPLE);
  const columns = keys.map((key, index) => ({
    key,
    label: result.columns[index] || key,
    type: inferType(sample.map((row) => row[index] ?? null))
  }));
  const rows = result.rows.map((row) => {
    const record = {};
    keys.forEach((key, index) => {
      record[key] = row[index] ?? null;
    });
    return record;
  });
  return { columns, rows, truncated: rows.length >= limit };
}

// src/ask.ts
var MAX_QUESTION_LENGTH = 2e3;
var MAX_HISTORY_TURNS = 6;
function newRequestId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `req_${Date.now().toString(36)}${random}`;
}
function isAbort(error) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
function createDashu(config) {
  const sourceNames = Object.keys(config.dataSources);
  if (!sourceNames.length) {
    throw new Error("createDashu requires at least one data source.");
  }
  const maxOutputTokens = config.maxOutputTokens ?? 2e3;
  function adapterFor(name) {
    const key = name ?? config.defaultDataSource ?? sourceNames[0];
    const adapter = config.dataSources[key];
    if (!adapter) {
      throw new DashuError(
        "DATA_SOURCE_NOT_CONFIGURED",
        `No data source named "${key}" is configured.`
      );
    }
    return { key, adapter };
  }
  function emit(event) {
    try {
      config.onEvent?.(event);
    } catch {
    }
  }
  async function loadSchemaPrompt(adapter, policy, signal) {
    const raw = await adapter.introspect(policy);
    signal?.throwIfAborted();
    const filtered = applySchemaPolicy(raw, policy);
    if (!filtered.tables.length) {
      throw new DashuError(
        "SCHEMA_UNAVAILABLE",
        "No tables are available in the approved schemas."
      );
    }
    return adapter.renderSchema(filtered);
  }
  async function executePlan(adapter, plan, policy, signal, repair) {
    let query = adapter.validate(plan.sql, policy);
    try {
      const result = await adapter.execute(query, {
        maxRows: policy.maxRows,
        timeoutMs: policy.statementTimeoutMs,
        signal
      });
      return { query, result };
    } catch (error) {
      if (error instanceof DashuError && error.code !== "QUERY_FAILED") throw error;
      if (isAbort(error)) throw error;
      const detail = error instanceof DashuError ? error.detail ?? error.message : error instanceof Error ? error.message : String(error);
      const corrected = await repair(detail);
      if (!corrected.sql) {
        throw new DashuError("QUERY_FAILED", "That query could not be run against this database.", {
          detail,
          cause: error
        });
      }
      query = adapter.validate(corrected.sql, policy);
      const result = await adapter.execute(query, {
        maxRows: policy.maxRows,
        timeoutMs: policy.statementTimeoutMs,
        signal
      });
      return { query, result };
    }
  }
  async function ask(request) {
    const requestId = request.requestId ?? newRequestId();
    const started = Date.now();
    const { key, adapter } = adapterFor(request.dataSource);
    try {
      requirePermission(request.actor, PERMISSIONS.ask);
      const question = typeof request.question === "string" ? request.question.trim() : "";
      if (!question) {
        throw new DashuError("INVALID_REQUEST", "Ask a question first.");
      }
      if (question.length > MAX_QUESTION_LENGTH) {
        throw new DashuError("INVALID_REQUEST", "That question is too long.");
      }
      const policy = resolvePolicy(
        { ...config.defaults, ...policyForActor(request.actor) },
        request.policy
      );
      const schemaPrompt = await loadSchemaPrompt(adapter, policy, request.signal);
      const history = (request.history ?? []).slice(-MAX_HISTORY_TURNS);
      const plan = await planQuery(config.ai, {
        question,
        dialectRules: adapter.promptRules(),
        schemaPrompt,
        semantic: request.semantic,
        history,
        maxOutputTokens,
        signal: request.signal
      });
      if (!plan.sql) {
        emit({
          requestId,
          actorId: request.actor.id,
          tenantId: request.actor.tenantId,
          dataSource: key,
          provider: config.ai.mode,
          dialect: adapter.dialect,
          durationMs: Date.now() - started,
          status: "unanswerable"
        });
        return {
          version: "1",
          answered: false,
          answer: {
            text: plan.explanation || "That question cannot be answered from this database."
          },
          meta: {
            requestId,
            durationMs: Date.now() - started,
            dataSource: key,
            provider: config.ai.mode
          }
        };
      }
      const { query, result } = await executePlan(
        adapter,
        plan,
        policy,
        request.signal,
        (error) => planQuery(config.ai, {
          question,
          dialectRules: adapter.promptRules(),
          schemaPrompt,
          semantic: request.semantic,
          history,
          repair: { sql: plan.sql, error },
          maxOutputTokens,
          signal: request.signal
        })
      );
      const data = toResultData(result, query.limit);
      const durationMs = Date.now() - started;
      emit({
        requestId,
        actorId: request.actor.id,
        tenantId: request.actor.tenantId,
        dataSource: key,
        provider: config.ai.mode,
        dialect: adapter.dialect,
        durationMs,
        rowCount: data.rows.length,
        status: "answered"
      });
      return {
        version: "1",
        answered: true,
        answer: { text: plan.explanation },
        data,
        display: resolveDisplay(plan.display, data),
        capabilities: {
          showSql: policy.exposeSql,
          export: policy.allowExport,
          saveDashboard: policy.allowSaveDashboard
        },
        // Generated SQL discloses schema and policy shape, so it ships only
        // when the server has decided this actor may see it.
        ...policy.exposeSql ? { query: { dialect: adapter.dialect, sql: query.sql } } : {},
        meta: {
          requestId,
          rowCount: data.rows.length,
          durationMs,
          dataSource: key,
          provider: config.ai.mode
        }
      };
    } catch (error) {
      throw finish(error, {
        requestId,
        started,
        dataSource: key,
        adapter,
        actor: request.actor
      });
    }
  }
  async function run(request) {
    const requestId = request.requestId ?? newRequestId();
    const started = Date.now();
    const { key, adapter } = adapterFor(request.dataSource);
    try {
      requirePermission(request.actor, PERMISSIONS.ask);
      const sql = typeof request.sql === "string" ? request.sql.trim() : "";
      if (!sql) throw new DashuError("INVALID_REQUEST", "No SQL to run.");
      const policy = resolvePolicy(
        { ...config.defaults, ...policyForActor(request.actor) },
        request.policy
      );
      const query = adapter.validate(sql, policy);
      const result = await adapter.execute(query, {
        maxRows: policy.maxRows,
        timeoutMs: policy.statementTimeoutMs,
        signal: request.signal
      });
      const data = toResultData(result, query.limit);
      const durationMs = Date.now() - started;
      emit({
        requestId,
        actorId: request.actor.id,
        tenantId: request.actor.tenantId,
        dataSource: key,
        provider: config.ai.mode,
        dialect: adapter.dialect,
        durationMs,
        rowCount: data.rows.length,
        status: "answered"
      });
      return {
        version: "1",
        answered: true,
        answer: { text: "" },
        data,
        display: resolveDisplay(request.display ?? { type: "table" }, data),
        capabilities: {
          showSql: policy.exposeSql,
          export: policy.allowExport,
          saveDashboard: policy.allowSaveDashboard
        },
        ...policy.exposeSql ? { query: { dialect: adapter.dialect, sql: query.sql } } : {},
        meta: {
          requestId,
          rowCount: data.rows.length,
          durationMs,
          dataSource: key,
          provider: config.ai.mode
        }
      };
    } catch (error) {
      throw finish(error, {
        requestId,
        started,
        dataSource: key,
        adapter,
        actor: request.actor
      });
    }
  }
  function finish(error, context) {
    const wrapped = isAbort(error) ? new DashuError("CANCELLED", "The request was cancelled.") : error instanceof DashuError ? error : new DashuError("INTERNAL", "Something went wrong handling that question.", {
      detail: error instanceof Error ? error.message : String(error),
      cause: error
    });
    emit({
      requestId: context.requestId,
      actorId: context.actor.id,
      tenantId: context.actor.tenantId,
      dataSource: context.dataSource,
      provider: config.ai.mode,
      dialect: context.adapter.dialect,
      durationMs: Date.now() - context.started,
      status: "error",
      errorCode: wrapped.code
    });
    return wrapped.withRequestId(context.requestId);
  }
  return {
    ask,
    run,
    async schema({ actor, dataSource, policy: policyInput, force }) {
      requirePermission(actor, PERMISSIONS.viewSchema);
      const { adapter } = adapterFor(dataSource);
      const policy = resolvePolicy(config.defaults, policyInput);
      const raw = await adapter.introspect(policy, { force });
      return applySchemaPolicy(raw, policy);
    },
    async testConnection(dataSource) {
      await adapterFor(dataSource).adapter.testConnection();
    },
    dataSourceNames() {
      return [...sourceNames];
    }
  };
}

exports.DashuError = DashuError;
exports.PERMISSIONS = PERMISSIONS;
exports.POLICY_DEFAULTS = POLICY_DEFAULTS;
exports.applySchemaPolicy = applySchemaPolicy;
exports.createDashu = createDashu;
exports.errorStatus = errorStatus;
exports.extractJson = extractJson;
exports.planQuery = planQuery;
exports.policyForActor = policyForActor;
exports.requirePermission = requirePermission;
exports.resolveDisplay = resolveDisplay;
exports.resolvePolicy = resolvePolicy;
exports.semanticToPrompt = semanticToPrompt;
exports.toErrorResponse = toErrorResponse;
exports.toResultData = toResultData;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map