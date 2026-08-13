import { DashuError } from "./errors";
import { planQuery, type QueryPlan } from "./planning";
import { applySchemaPolicy, policyForActor, requirePermission, resolvePolicy } from "./policy";
import { resolveDisplay } from "./display-spec";
import { toResultData } from "./result";
import {
  PERMISSIONS,
  type DashuAiProvider,
  type DashuDatabaseAdapter,
  type DashuPolicy,
  type DashuPolicyInput,
  type AskRequest,
  type AskResult,
  type DatabaseSchema,
  type QueryResult,
  type RunRequest,
  type ValidatedQuery,
} from "./types";

export type DashuConfig = {
  ai: DashuAiProvider;
  /**
   * Approved sources, by name. The caller picks one by key — never by
   * connection string, so a request body can never point Dashu at a database
   * the operator did not approve.
   */
  dataSources: Record<string, DashuDatabaseAdapter>;
  defaultDataSource?: string;
  defaults?: DashuPolicyInput;
  /** Ceiling on generated tokens per model call. A query plan is small. */
  maxOutputTokens?: number;
  /**
   * Called once per completed request with metadata only. Questions, SQL and
   * rows are deliberately absent — see the observability section of the docs.
   */
  onEvent?: (event: DashuEvent) => void;
};

export type DashuEvent = {
  requestId: string;
  actorId: string;
  tenantId?: string;
  dataSource: string;
  provider: string;
  dialect: string;
  durationMs: number;
  rowCount?: number;
  status: "answered" | "unanswerable" | "error";
  errorCode?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

const MAX_QUESTION_LENGTH = 2000;
/** Enough for a follow-up to make sense without unbounding the prompt. */
const MAX_HISTORY_TURNS = 6;

function newRequestId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `req_${Date.now().toString(36)}${random}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export type Dashu = {
  ask(request: AskRequest): Promise<AskResult>;
  /** Re-run stored SQL — a dashboard card, without a model call. */
  run(request: RunRequest): Promise<AskResult>;
  /** Approved schema for a data source, for a schema browser. */
  schema(request: {
    actor: AskRequest["actor"];
    dataSource?: string;
    policy?: DashuPolicyInput;
    force?: boolean;
  }): Promise<DatabaseSchema>;
  testConnection(dataSource?: string): Promise<void>;
  dataSourceNames(): string[];
};

export function createDashu(config: DashuConfig): Dashu {
  const sourceNames = Object.keys(config.dataSources);
  if (!sourceNames.length) {
    throw new Error("createDashu requires at least one data source.");
  }

  const maxOutputTokens = config.maxOutputTokens ?? 2000;

  function adapterFor(name: string | undefined): { key: string; adapter: DashuDatabaseAdapter } {
    const key = name ?? config.defaultDataSource ?? sourceNames[0];
    const adapter = config.dataSources[key];
    if (!adapter) {
      // The name is echoed back because the caller is the host backend, which
      // chose it — this is a configuration mistake, not untrusted input.
      throw new DashuError(
        "DATA_SOURCE_NOT_CONFIGURED",
        `No data source named "${key}" is configured.`,
      );
    }
    return { key, adapter };
  }

  function emit(event: DashuEvent): void {
    try {
      config.onEvent?.(event);
    } catch {
      // Observability must never be able to fail a request.
    }
  }

  async function loadSchemaPrompt(
    adapter: DashuDatabaseAdapter,
    policy: DashuPolicy,
    signal?: AbortSignal,
  ): Promise<string> {
    const raw = await adapter.introspect(policy);
    signal?.throwIfAborted();

    const filtered = applySchemaPolicy(raw, policy);
    if (!filtered.tables.length) {
      throw new DashuError(
        "SCHEMA_UNAVAILABLE",
        "No tables are available in the approved schemas.",
      );
    }
    return adapter.renderSchema(filtered);
  }

  async function executePlan(
    adapter: DashuDatabaseAdapter,
    plan: QueryPlan,
    policy: DashuPolicy,
    signal: AbortSignal | undefined,
    repair: (error: string) => Promise<QueryPlan>,
  ): Promise<{ query: ValidatedQuery; result: QueryResult }> {
    let query = adapter.validate(plan.sql, policy);

    try {
      const result = await adapter.execute(query, {
        maxRows: policy.maxRows,
        timeoutMs: policy.statementTimeoutMs,
        signal,
      });
      return { query, result };
    } catch (error) {
      // A timeout or a cancellation is not something the model can fix, and a
      // second attempt would only spend the budget again.
      if (error instanceof DashuError && error.code !== "QUERY_FAILED") throw error;
      if (isAbort(error)) throw error;

      // One repair attempt: hand the model the error and let it correct itself.
      // Anything beyond that tends to loop rather than converge.
      //
      // `detail` carries the driver's own message, which is what makes the
      // repair work. It goes to the model, never into a response.
      const detail =
        error instanceof DashuError
          ? (error.detail ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error);

      const corrected = await repair(detail);
      if (!corrected.sql) {
        throw new DashuError("QUERY_FAILED", "That query could not be run against this database.", {
          detail,
          cause: error,
        });
      }

      query = adapter.validate(corrected.sql, policy);
      const result = await adapter.execute(query, {
        maxRows: policy.maxRows,
        timeoutMs: policy.statementTimeoutMs,
        signal,
      });
      return { query, result };
    }
  }

  async function ask(request: AskRequest): Promise<AskResult> {
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
        request.policy,
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
        signal: request.signal,
      });

      // The model declining is a legitimate outcome: the approved schema
      // genuinely may not contain what was asked for.
      if (!plan.sql) {
        emit({
          requestId,
          actorId: request.actor.id,
          tenantId: request.actor.tenantId,
          dataSource: key,
          provider: config.ai.mode,
          dialect: adapter.dialect,
          durationMs: Date.now() - started,
          status: "unanswerable",
        });

        return {
          version: "1",
          answered: false,
          answer: {
            text: plan.explanation || "That question cannot be answered from this database.",
          },
          meta: {
            requestId,
            durationMs: Date.now() - started,
            dataSource: key,
            provider: config.ai.mode,
          },
        };
      }

      const { query, result } = await executePlan(adapter, plan, policy, request.signal, (error) =>
        planQuery(config.ai, {
          question,
          dialectRules: adapter.promptRules(),
          schemaPrompt,
          semantic: request.semantic,
          history,
          repair: { sql: plan.sql, error },
          maxOutputTokens,
          signal: request.signal,
        }),
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
        status: "answered",
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
          saveDashboard: policy.allowSaveDashboard,
        },
        // Generated SQL discloses schema and policy shape, so it ships only
        // when the server has decided this actor may see it.
        ...(policy.exposeSql ? { query: { dialect: adapter.dialect, sql: query.sql } } : {}),
        meta: {
          requestId,
          rowCount: data.rows.length,
          durationMs,
          dataSource: key,
          provider: config.ai.mode,
        },
      };
    } catch (error) {
      throw finish(error, {
        requestId,
        started,
        dataSource: key,
        adapter,
        actor: request.actor,
      });
    }
  }

  async function run(request: RunRequest): Promise<AskResult> {
    const requestId = request.requestId ?? newRequestId();
    const started = Date.now();
    const { key, adapter } = adapterFor(request.dataSource);

    try {
      requirePermission(request.actor, PERMISSIONS.ask);

      const sql = typeof request.sql === "string" ? request.sql.trim() : "";
      if (!sql) throw new DashuError("INVALID_REQUEST", "No SQL to run.");

      const policy = resolvePolicy(
        { ...config.defaults, ...policyForActor(request.actor) },
        request.policy,
      );

      // Stored SQL is still validated. A saved card is stored data, and stored
      // data is not trusted input just because we wrote it earlier — and the
      // policy it was saved under may since have narrowed.
      const query = adapter.validate(sql, policy);
      const result = await adapter.execute(query, {
        maxRows: policy.maxRows,
        timeoutMs: policy.statementTimeoutMs,
        signal: request.signal,
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
        status: "answered",
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
          saveDashboard: policy.allowSaveDashboard,
        },
        ...(policy.exposeSql ? { query: { dialect: adapter.dialect, sql: query.sql } } : {}),
        meta: {
          requestId,
          rowCount: data.rows.length,
          durationMs,
          dataSource: key,
          provider: config.ai.mode,
        },
      };
    } catch (error) {
      throw finish(error, {
        requestId,
        started,
        dataSource: key,
        adapter,
        actor: request.actor,
      });
    }
  }

  function finish(
    error: unknown,
    context: {
      requestId: string;
      started: number;
      dataSource: string;
      adapter: DashuDatabaseAdapter;
      actor: AskRequest["actor"];
    },
  ): DashuError {
    const wrapped = isAbort(error)
      ? new DashuError("CANCELLED", "The request was cancelled.")
      : error instanceof DashuError
        ? error
        : new DashuError("INTERNAL", "Something went wrong handling that question.", {
            detail: error instanceof Error ? error.message : String(error),
            cause: error,
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
      errorCode: wrapped.code,
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
    },
  };
}
