import type { DisplayPlan, DisplaySpec, DisplayType, ResultData } from "./types";

/**
 * Turn the model's rendering suggestion into one the host can trust.
 *
 * Everything here is a check against the result that actually came back, not
 * against what the model claimed. A spec naming a column that is not in the
 * result would otherwise reach a component and render nothing, or throw.
 */

const MAX_TITLE = 120;
/** Beyond this a chart is unreadable and a table is the honest answer. */
const MAX_CHART_ROWS = 60;

const CHART_TYPES = new Set<DisplayType>([
  "bar-chart",
  "line-chart",
  "area-chart",
  "pie-chart",
  "scatter-chart",
]);

function cleanTitle(title: string | undefined): string | undefined {
  if (typeof title !== "string") return undefined;
  // Strip control characters: a title goes straight into a DOM text node, and
  // bounded plain text is the only thing that should.
  const clean = title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE).trimEnd()}…` : clean;
}

function numericValues(data: ResultData, key: string): number[] {
  return data.rows
    .map((row) => {
      const value = row[key];
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((value): value is number => value !== null);
}

function isNumeric(data: ResultData, key: string): boolean {
  const column = data.columns.find((c) => c.key === key);
  if (!column) return false;
  if (column.type === "number") return true;
  // A column typed `unknown` because of nulls can still plot if its values do.
  return column.type === "unknown" && numericValues(data, key).length >= 2;
}

/** Which chart types this particular result can actually support. */
function supported(data: ResultData, x: string, y: string): DisplayType[] {
  if (data.rows.length < 2 || data.rows.length > MAX_CHART_ROWS) return [];
  if (!data.columns.some((c) => c.key === x)) return [];
  if (!isNumeric(data, y)) return [];

  const types: DisplayType[] = ["bar-chart", "line-chart", "area-chart"];

  const values = numericValues(data, y);
  // A pie chart divides one whole, so negatives make it meaningless.
  if (values.length === data.rows.length && values.every((v) => v >= 0) && values.some((v) => v > 0)) {
    types.push("pie-chart");
  }
  if (isNumeric(data, x)) types.push("scatter-chart");

  return types;
}

function resolveKey(data: ResultData, name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (data.columns.some((column) => column.key === name)) return name;
  // The model aliases in the SELECT; duplicate names were suffixed on the way
  // in, so fall back to the first column carrying that label.
  return data.columns.find((column) => column.label === name)?.key;
}

/**
 * Validate the model's suggestion and offer the alternatives the data supports,
 * so a display switcher never presents a view that cannot be drawn.
 */
export function resolveDisplay(suggestion: DisplaySpec, data: ResultData): DisplayPlan {
  const title = cleanTitle(suggestion.title);
  const table: DisplaySpec = { type: "table", ...(title ? { title } : {}) };

  if (!data.columns.length || !data.rows.length) return { primary: table, alternatives: [] };

  if (suggestion.type === "metric") {
    // One row, one value — anything else is not a metric no matter what the
    // model called it.
    const key = resolveKey(data, suggestion.y) ?? data.columns[0].key;
    if (data.rows.length === 1 && isNumeric(data, key)) {
      return {
        primary: { type: "metric", y: key, ...(title ? { title } : {}) },
        alternatives: [{ type: "table" }],
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

  // The model proposes; if its choice does not fit the data, fall back to the
  // bar chart, which every plottable result supports.
  const type = available.includes(suggestion.type) ? suggestion.type : "bar-chart";

  return {
    primary: { type, x, y, ...(title ? { title } : {}) },
    alternatives: [
      ...available.filter((other) => other !== type).map((other) => ({ type: other, x, y })),
      { type: "table" as const },
    ],
  };
}
