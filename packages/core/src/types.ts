/**
 * The contracts every other package is written against.
 *
 * Nothing here reads global state. An `ask()` call carries its own actor,
 * policy and data source, so two concurrent requests in the same process can
 * never see each other's tenant, schema policy or credentials.
 */

/* -- actor ----------------------------------------------------------------- */

/**
 * Who is asking, as established by the host product's own authentication.
 *
 * These values are trusted, which is precisely why they must be derived
 * server-side from an authenticated session and never read from a request body.
 */
export type DashuActor = {
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

export const PERMISSIONS = {
  ask: "dashu:ask",
  viewSchema: "dashu:view-schema",
  viewSql: "dashu:view-sql",
  export: "dashu:export",
  saveDashboard: "dashu:save-dashboard",
} as const;

/* -- policy ---------------------------------------------------------------- */

/** Which schemas, tables and columns the model is allowed to know about. */
export type SchemaPolicy = {
  /** Schemas to introspect. An empty list means "the adapter's default". */
  schemas: string[];
  /** `schema.table` entries removed after introspection. */
  denyTables: string[];
  /** `schema.table.column` entries removed after introspection. */
  denyColumns: string[];
};

/** What a single query may do once planned. */
export type QueryPolicy = {
  maxRows: number;
  statementTimeoutMs: number;
};

/** What the caller is allowed to see of the result. */
export type DisclosurePolicy = {
  exposeSql: boolean;
  allowExport: boolean;
  allowSaveDashboard: boolean;
};

export type DashuPolicy = SchemaPolicy & QueryPolicy & DisclosurePolicy;

/** Everything is optional at the call site; `resolvePolicy` fills the gaps. */
export type DashuPolicyInput = Partial<DashuPolicy>;

/* -- schema ---------------------------------------------------------------- */

export type SchemaColumn = {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** Allowed values, when the column's type is an enumeration. */
  enumValues?: string[];
  comment?: string;
};

export type SchemaTable = {
  schema: string;
  name: string;
  kind: "table" | "view";
  columns: SchemaColumn[];
  comment?: string;
};

export type SchemaRelationship = {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
};

export type DatabaseSchema = {
  tables: SchemaTable[];
  relationships: SchemaRelationship[];
  readAt: number;
};

/* -- semantic layer -------------------------------------------------------- */

/**
 * Business vocabulary layered over the physical schema, so "revenue" resolves
 * to an approved expression instead of being guessed at.
 */
export type SemanticLayer = {
  terms: Record<string, string>;
  notes: string[];
};

/* -- AI provider ----------------------------------------------------------- */

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiCompletionRequest = {
  messages: AiMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type AiCompletionResponse = {
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
export type DashuAiProvider = {
  /** Human-readable, and safe to put in an error message. */
  name: string;
  /** Identifies the mode for logging: "managed", "openrouter", "local". */
  mode: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
};

/* -- database adapter ------------------------------------------------------ */

/** SQL that has passed the adapter's validator and is safe to execute. */
export type ValidatedQuery = {
  /** The statement as written, cleaned but semantically unchanged. */
  sql: string;
  /** What actually runs — usually `sql` wrapped in a hard row limit. */
  executable: string;
  limit: number;
};

export type Cell = string | number | boolean | null;

export type QueryResult = {
  /** Column names in result order. Duplicates are possible and preserved. */
  columns: string[];
  /** Positional rows, so two columns of the same name stay distinct. */
  rows: Cell[][];
};

export interface DashuDatabaseAdapter {
  /** "postgresql", "mysql", … — carried into the response contract. */
  dialect: string;

  testConnection(): Promise<void>;

  introspect(policy: SchemaPolicy, options?: { force?: boolean }): Promise<DatabaseSchema>;

  /**
   * Render the schema as prompt text. Dialect-owned because identifier quoting
   * decides whether the model writes a name the database can actually resolve.
   */
  renderSchema(schema: DatabaseSchema): string;

  /** Dialect-specific SQL rules appended to the planner's system prompt. */
  promptRules(): string;

  validate(sql: string, policy: QueryPolicy): ValidatedQuery;

  execute(
    query: ValidatedQuery,
    options: { maxRows: number; timeoutMs: number; signal?: AbortSignal },
  ): Promise<QueryResult>;
}

/* -- display specification ------------------------------------------------- */

export type DisplayType =
  | "table"
  | "metric"
  | "bar-chart"
  | "line-chart"
  | "area-chart"
  | "pie-chart"
  | "scatter-chart";

/**
 * A validated, declarative rendering suggestion. Never HTML, never JavaScript —
 * the host maps this onto components it already trusts.
 */
export type DisplaySpec = {
  type: DisplayType;
  title?: string;
  /** Column key for the category or x axis. Absent for `table`. */
  x?: string;
  /** Column key for the measure or y axis. Absent for `table`. */
  y?: string;
};

export type DisplayPlan = {
  primary: DisplaySpec;
  alternatives: DisplaySpec[];
};

/* -- result contract ------------------------------------------------------- */

export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export type ResultColumn = {
  /** Unique within the result — duplicate names are suffixed. */
  key: string;
  label: string;
  type: ColumnType;
};

export type ResultData = {
  columns: ResultColumn[];
  /** Keyed by `ResultColumn.key`, which is why the keys are deduplicated. */
  rows: Record<string, Cell>[];
  truncated: boolean;
};

export type AskCapabilities = {
  showSql: boolean;
  export: boolean;
  saveDashboard: boolean;
};

export type AskMeta = {
  requestId: string;
  rowCount: number;
  durationMs: number;
  dataSource: string;
  provider: string;
};

/** A question the schema could answer. */
export type AskAnswered = {
  version: "1";
  answered: true;
  answer: { text: string };
  data: ResultData;
  display: DisplayPlan;
  capabilities: AskCapabilities;
  /** Present only when `policy.exposeSql` allows it. */
  query?: { dialect: string; sql: string };
  meta: AskMeta;
};

/**
 * The model declined, because the approved schema does not contain the data.
 * Not an error: the question was understood and the honest answer is "no".
 */
export type AskUnanswerable = {
  version: "1";
  answered: false;
  answer: { text: string };
  meta: Pick<AskMeta, "requestId" | "durationMs" | "dataSource" | "provider">;
};

export type AskResult = AskAnswered | AskUnanswerable;

/* -- request --------------------------------------------------------------- */

/** Earlier turns, so "now break that down by month" resolves. */
export type AskTurn = {
  question: string;
  sql: string;
};

export type AskRequest = {
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
export type RunRequest = {
  sql: string;
  actor: DashuActor;
  dataSource?: string;
  policy?: DashuPolicyInput;
  display?: DisplaySpec;
  signal?: AbortSignal;
  requestId?: string;
};
