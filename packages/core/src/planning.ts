import { extractJson } from "./json";
import type {
  AiMessage,
  DashuAiProvider,
  AskTurn,
  DisplaySpec,
  DisplayType,
  SemanticLayer,
} from "./types";

export type QueryPlan = {
  /** Empty when the model declines — the schema does not cover the question. */
  sql: string;
  explanation: string;
  display: DisplaySpec;
};

const DISPLAY_TYPES = new Set<DisplayType>([
  "table",
  "metric",
  "bar-chart",
  "line-chart",
  "area-chart",
  "pie-chart",
  "scatter-chart",
]);

const BASE_INSTRUCTIONS = `You are Dashu, a query layer that turns questions into a single read-only SQL query.

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

Response format — this matters:
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
    "pie-chart"     parts of a single whole — 2 to 8 categories, no negatives
    "scatter-chart" the relationship between two numeric columns; "x" is the x axis and must itself be numeric
    "table"         wide results, or anything with more than about 30 rows
  "x" and "y" must name columns exactly as you aliased them in the SELECT — a name that is not in the result means the chart is dropped and a table is shown instead. Use empty strings for "table". Prefer a bar chart over a pie chart whenever the question is about ranking rather than composition.
- If the question cannot be answered from this schema, set "sql" to an empty string and use "explanation" to say what is missing. Do not guess at tables that are not there.`;

export type PlanRequest = {
  question: string;
  /** Dialect-specific rules, supplied by the database adapter. */
  dialectRules: string;
  schemaPrompt: string;
  semantic?: SemanticLayer;
  history?: AskTurn[];
  /** Set when a previous attempt failed, to ask for a correction. */
  repair?: { sql: string; error: string };
  maxOutputTokens: number;
  signal?: AbortSignal;
};

type RawPlan = {
  sql?: unknown;
  explanation?: unknown;
  display?: {
    type?: unknown;
    title?: unknown;
    x?: unknown;
    y?: unknown;
  };
};

function asString(value: unknown, maxLength = 400): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function asDisplayType(value: unknown): DisplayType {
  return typeof value === "string" && DISPLAY_TYPES.has(value as DisplayType)
    ? (value as DisplayType)
    : "table";
}

export function semanticToPrompt(layer: SemanticLayer | undefined): string {
  if (!layer) return "";
  const lines: string[] = [];
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

/**
 * Ask the model for a query plan.
 *
 * The provider only ever sees the question, the filtered schema and approved
 * vocabulary. No credentials, no result rows, no host session — see the
 * assembly below, which is the whole of what leaves this process.
 */
export async function planQuery(
  provider: DashuAiProvider,
  request: PlanRequest,
): Promise<QueryPlan> {
  const system = [
    BASE_INSTRUCTIONS,
    request.dialectRules,
    `Database schema:\n\n${request.schemaPrompt}`,
    semanticToPrompt(request.semantic),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const messages: AiMessage[] = [{ role: "system", content: system }];

  for (const turn of request.history ?? []) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: `Previous query:\n${turn.sql}` });
  }

  if (request.repair) {
    messages.push({
      role: "user",
      content:
        `${request.question}\n\n` +
        "Your previous attempt failed. Rewrite it so it runs.\n\n" +
        `Query:\n${request.repair.sql}\n\n` +
        `Database error:\n${request.repair.error}\n\n` +
        "Reply with the same raw JSON object as before.",
    });
  } else {
    messages.push({ role: "user", content: request.question });
  }

  const completion = await provider.complete({
    messages,
    maxOutputTokens: request.maxOutputTokens,
    signal: request.signal,
  });

  const parsed = extractJson<RawPlan>(completion.content);

  return {
    sql: asString(parsed.sql, 20_000),
    explanation: asString(parsed.explanation, 600),
    display: {
      type: asDisplayType(parsed.display?.type),
      title: asString(parsed.display?.title, 120) || undefined,
      x: asString(parsed.display?.x, 200) || undefined,
      y: asString(parsed.display?.y, 200) || undefined,
    },
  };
}
