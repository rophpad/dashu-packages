/**
 * The contracts every other package is written against.
 *
 * Nothing here reads global state. An `ask()` call carries its own actor,
 * policy and data source, so two concurrent requests in the same process can
 * never see each other's tenant, schema policy or credentials.
 */
/**
 * Who is asking, as established by the host product's own authentication.
 *
 * These values are trusted, which is precisely why they must be derived
 * server-side from an authenticated session and never read from a request body.
 */
type DashuActor = {
    id: string;
    /**
     * Which tenant this actor belongs to. Optional, and carried rather than
     * enforced: it reaches `selectDataSource`, `getPolicy` and the event stream so
     * a host can route to the right database and attribute usage.
     *
     * Setting it does not isolate anything. Nothing in this package filters rows
     * by tenant, and a generated query will not reliably do it either. Isolation
     * comes from a per-tenant connection, a per-tenant schema, or row-level
     * security — see the security section of the documentation.
     */
    tenantId?: string;
    permissions: readonly string[];
};
declare const PERMISSIONS: {
    readonly ask: "dashu:ask";
    readonly viewSchema: "dashu:view-schema";
    readonly viewSql: "dashu:view-sql";
    readonly export: "dashu:export";
    readonly saveDashboard: "dashu:save-dashboard";
};
/** Which schemas, tables and columns the model is allowed to know about. */
type SchemaPolicy = {
    /** Schemas to introspect. An empty list means "the adapter's default". */
    schemas: string[];
    /** `schema.table` entries removed after introspection. */
    denyTables: string[];
    /** `schema.table.column` entries removed after introspection. */
    denyColumns: string[];
};
/** What a single query may do once planned. */
type QueryPolicy = {
    maxRows: number;
    statementTimeoutMs: number;
};
/** What the caller is allowed to see of the result. */
type DisclosurePolicy = {
    exposeSql: boolean;
    allowExport: boolean;
    allowSaveDashboard: boolean;
};
type DashuPolicy = SchemaPolicy & QueryPolicy & DisclosurePolicy;
/** Everything is optional at the call site; `resolvePolicy` fills the gaps. */
type DashuPolicyInput = Partial<DashuPolicy>;
type SchemaColumn = {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    /** Allowed values, when the column's type is an enumeration. */
    enumValues?: string[];
    comment?: string;
};
type SchemaTable = {
    schema: string;
    name: string;
    kind: "table" | "view";
    columns: SchemaColumn[];
    comment?: string;
};
type SchemaRelationship = {
    fromSchema: string;
    fromTable: string;
    fromColumn: string;
    toSchema: string;
    toTable: string;
    toColumn: string;
};
type DatabaseSchema = {
    tables: SchemaTable[];
    relationships: SchemaRelationship[];
    readAt: number;
};
/**
 * Business vocabulary layered over the physical schema, so "revenue" resolves
 * to an approved expression instead of being guessed at.
 */
type SemanticLayer = {
    terms: Record<string, string>;
    notes: string[];
};
type AiMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};
type AiCompletionRequest = {
    messages: AiMessage[];
    maxOutputTokens: number;
    signal?: AbortSignal;
};
type AiCompletionResponse = {
    content: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
};
/**
 * The only thing core knows about a model. Managed AI, OpenRouter and a
 * self-hosted endpoint are interchangeable behind this.
 */
type DashuAiProvider = {
    /** Human-readable, and safe to put in an error message. */
    name: string;
    /** Identifies the mode for logging: "managed", "openrouter", "local". */
    mode: string;
    complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
};
/** SQL that has passed the adapter's validator and is safe to execute. */
type ValidatedQuery = {
    /** The statement as written, cleaned but semantically unchanged. */
    sql: string;
    /** What actually runs — usually `sql` wrapped in a hard row limit. */
    executable: string;
    limit: number;
};
type Cell = string | number | boolean | null;
type QueryResult = {
    /** Column names in result order. Duplicates are possible and preserved. */
    columns: string[];
    /** Positional rows, so two columns of the same name stay distinct. */
    rows: Cell[][];
};
interface DashuDatabaseAdapter {
    /** "postgresql", "mysql", … — carried into the response contract. */
    dialect: string;
    testConnection(): Promise<void>;
    introspect(policy: SchemaPolicy, options?: {
        force?: boolean;
    }): Promise<DatabaseSchema>;
    /**
     * Render the schema as prompt text. Dialect-owned because identifier quoting
     * decides whether the model writes a name the database can actually resolve.
     */
    renderSchema(schema: DatabaseSchema): string;
    /** Dialect-specific SQL rules appended to the planner's system prompt. */
    promptRules(): string;
    validate(sql: string, policy: QueryPolicy): ValidatedQuery;
    execute(query: ValidatedQuery, options: {
        maxRows: number;
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<QueryResult>;
}
type DisplayType = "table" | "metric" | "bar-chart" | "line-chart" | "area-chart" | "pie-chart" | "scatter-chart";
/**
 * A validated, declarative rendering suggestion. Never HTML, never JavaScript —
 * the host maps this onto components it already trusts.
 */
type DisplaySpec = {
    type: DisplayType;
    title?: string;
    /** Column key for the category or x axis. Absent for `table`. */
    x?: string;
    /** Column key for the measure or y axis. Absent for `table`. */
    y?: string;
};
type DisplayPlan = {
    primary: DisplaySpec;
    alternatives: DisplaySpec[];
};
type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";
type ResultColumn = {
    /** Unique within the result — duplicate names are suffixed. */
    key: string;
    label: string;
    type: ColumnType;
};
type ResultData = {
    columns: ResultColumn[];
    /** Keyed by `ResultColumn.key`, which is why the keys are deduplicated. */
    rows: Record<string, Cell>[];
    truncated: boolean;
};
type AskCapabilities = {
    showSql: boolean;
    export: boolean;
    saveDashboard: boolean;
};
type AskMeta = {
    requestId: string;
    rowCount: number;
    durationMs: number;
    dataSource: string;
    provider: string;
};
/** A question the schema could answer. */
type AskAnswered = {
    version: "1";
    answered: true;
    answer: {
        text: string;
    };
    data: ResultData;
    display: DisplayPlan;
    capabilities: AskCapabilities;
    /** Present only when `policy.exposeSql` allows it. */
    query?: {
        dialect: string;
        sql: string;
    };
    meta: AskMeta;
};
/**
 * The model declined, because the approved schema does not contain the data.
 * Not an error: the question was understood and the honest answer is "no".
 */
type AskUnanswerable = {
    version: "1";
    answered: false;
    answer: {
        text: string;
    };
    meta: Pick<AskMeta, "requestId" | "durationMs" | "dataSource" | "provider">;
};
type AskResult = AskAnswered | AskUnanswerable;
/** Earlier turns, so "now break that down by month" resolves. */
type AskTurn = {
    question: string;
    sql: string;
};
type AskRequest = {
    question: string;
    actor: DashuActor;
    /** Key into the configured `dataSources`. */
    dataSource?: string;
    policy?: DashuPolicyInput;
    history?: AskTurn[];
    semantic?: SemanticLayer;
    signal?: AbortSignal;
    requestId?: string;
};
/** Replaying stored SQL — a dashboard card, not a new question. */
type RunRequest = {
    sql: string;
    actor: DashuActor;
    dataSource?: string;
    policy?: DashuPolicyInput;
    display?: DisplaySpec;
    signal?: AbortSignal;
    requestId?: string;
};

/**
 * Structured errors that are safe to return over HTTP.
 *
 * The rule this file exists to enforce: whatever went wrong internally, the
 * caller receives a code, a sentence written for a human, and a request id.
 * Connection strings, provider payloads, prompt bodies and stack traces stay on
 * the server — see `toResponse`.
 */
type DashuErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST" | "AI_NOT_CONFIGURED" | "AI_UNAVAILABLE" | "DATA_SOURCE_NOT_CONFIGURED" | "SCHEMA_UNAVAILABLE" | "QUERY_NOT_ALLOWED" | "QUERY_TIMEOUT" | "QUERY_FAILED" | "RESULT_LIMIT_EXCEEDED" | "CANCELLED" | "INTERNAL";
declare class DashuError extends Error {
    readonly code: DashuErrorCode;
    readonly status: number;
    readonly requestId?: string;
    /**
     * Extra context for the server log only. Never serialised into a response —
     * this is where a driver message or a provider status ends up.
     */
    readonly detail?: string;
    constructor(code: DashuErrorCode, message: string, options?: {
        requestId?: string;
        detail?: string;
        cause?: unknown;
    });
    withRequestId(requestId: string): DashuError;
}
type DashuErrorResponse = {
    error: {
        code: DashuErrorCode;
        message: string;
        requestId?: string;
    };
};
/**
 * The only thing that should ever reach a browser.
 *
 * An unrecognised error becomes a generic INTERNAL rather than leaking its
 * message: an unexpected throw is exactly the case where the text is most
 * likely to contain a connection string or a file path.
 */
declare function toErrorResponse(error: unknown, requestId: string): DashuErrorResponse;
declare function errorStatus(error: unknown): number;

type DashuConfig = {
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
type DashuEvent = {
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
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
};
type Dashu = {
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
declare function createDashu(config: DashuConfig): Dashu;

/** Applied when neither the call site nor `createDashu` specifies otherwise. */
declare const POLICY_DEFAULTS: DashuPolicy;
/**
 * Merge instance defaults with per-request policy.
 *
 * Disclosure flags are intersected rather than overridden: a request may narrow
 * what it exposes, never widen it. Anything a caller could widen from the
 * request body would stop being a policy.
 */
declare function resolvePolicy(defaults: DashuPolicyInput | undefined, request: DashuPolicyInput | undefined): DashuPolicy;
declare function policyForActor(actor: DashuActor): DashuPolicyInput;
declare function requirePermission(actor: DashuActor, permission: string): void;
/**
 * Strip denied tables and columns from an introspected schema.
 *
 * This runs before the schema is rendered into a prompt, so a denied table is
 * not merely unmentioned in the instructions — the model never learns it
 * exists. That is the difference between a policy and a suggestion.
 *
 * It is not the security boundary. Database grants are; this keeps the model
 * from writing a query that would be rejected anyway, and keeps private column
 * names out of the provider request.
 */
declare function applySchemaPolicy(schema: DatabaseSchema, policy: SchemaPolicy): DatabaseSchema;

/**
 * Validate the model's suggestion and offer the alternatives the data supports,
 * so a display switcher never presents a view that cannot be drawn.
 */
declare function resolveDisplay(suggestion: DisplaySpec, data: ResultData): DisplayPlan;

declare function toResultData(result: QueryResult, limit: number): ResultData;

type QueryPlan = {
    /** Empty when the model declines — the schema does not cover the question. */
    sql: string;
    explanation: string;
    display: DisplaySpec;
};
type PlanRequest = {
    question: string;
    /** Dialect-specific rules, supplied by the database adapter. */
    dialectRules: string;
    schemaPrompt: string;
    semantic?: SemanticLayer;
    history?: AskTurn[];
    /** Set when a previous attempt failed, to ask for a correction. */
    repair?: {
        sql: string;
        error: string;
    };
    maxOutputTokens: number;
    signal?: AbortSignal;
};
declare function semanticToPrompt(layer: SemanticLayer | undefined): string;
/**
 * Ask the model for a query plan.
 *
 * The provider only ever sees the question, the filtered schema and approved
 * vocabulary. No credentials, no result rows, no host session — see the
 * assembly below, which is the whole of what leaves this process.
 */
declare function planQuery(provider: DashuAiProvider, request: PlanRequest): Promise<QueryPlan>;

/**
 * Pull a JSON object out of a model reply.
 *
 * The output contract is carried by the prompt rather than a `response_format`
 * parameter, because OpenAI-compatible providers do not consistently support
 * the same structured-output features. So the reply arrives bare, fenced, or
 * wrapped in prose, and all three have to work.
 */
declare function extractJson<T>(text: string): T;

export { type AiCompletionRequest, type AiCompletionResponse, type AiMessage, type AskAnswered, type AskCapabilities, type AskMeta, type AskRequest, type AskResult, type AskTurn, type AskUnanswerable, type Cell, type ColumnType, type Dashu, type DashuActor, type DashuAiProvider, type DashuConfig, type DashuDatabaseAdapter, DashuError, type DashuErrorCode, type DashuErrorResponse, type DashuEvent, type DashuPolicy, type DashuPolicyInput, type DatabaseSchema, type DisclosurePolicy, type DisplayPlan, type DisplaySpec, type DisplayType, PERMISSIONS, POLICY_DEFAULTS, type PlanRequest, type QueryPlan, type QueryPolicy, type QueryResult, type ResultColumn, type ResultData, type RunRequest, type SchemaColumn, type SchemaPolicy, type SchemaRelationship, type SchemaTable, type SemanticLayer, type ValidatedQuery, applySchemaPolicy, createDashu, errorStatus, extractJson, planQuery, policyForActor, requirePermission, resolveDisplay, resolvePolicy, semanticToPrompt, toErrorResponse, toResultData };
