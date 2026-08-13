import type { Cell, ColumnType, QueryResult, ResultColumn, ResultData } from "./types";

/**
 * Give every column a key that is unique within the result.
 *
 * The driver hands back positional rows precisely because a join can select two
 * columns with the same name — `SELECT u.name, c.name`. The response contract
 * uses object rows, so the duplicate has to become `name_2` rather than
 * silently overwriting the first value.
 */
function uniqueKeys(columns: string[]): string[] {
  const used = new Map<string, number>();

  return columns.map((name, index) => {
    const base = name || `column_${index + 1}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}_${seen + 1}`;
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
/** Postgres returns numeric and bigint as strings to preserve precision. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Infer a column's type from the values actually present.
 *
 * Driver type OIDs would be more direct, but they are dialect-specific and this
 * runs above the adapter. The consumer of this field is a chart renderer
 * deciding whether an axis is numeric, so agreement with the data matters more
 * than agreement with the catalog.
 */
function inferType(values: Cell[]): ColumnType {
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

/** Sample rather than scan: type inference on a 10,000-row result is wasted work. */
const TYPE_SAMPLE = 50;

export function toResultData(result: QueryResult, limit: number): ResultData {
  const keys = uniqueKeys(result.columns);
  const sample = result.rows.slice(0, TYPE_SAMPLE);

  const columns: ResultColumn[] = keys.map((key, index) => ({
    key,
    label: result.columns[index] || key,
    type: inferType(sample.map((row) => row[index] ?? null)),
  }));

  const rows = result.rows.map((row) => {
    const record: Record<string, Cell> = {};
    keys.forEach((key, index) => {
      record[key] = row[index] ?? null;
    });
    return record;
  });

  return { columns, rows, truncated: rows.length >= limit };
}
