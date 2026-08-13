import type { Cell, DisplaySpec, ResultData } from "@rophpad/dashu-core";

/** One plottable observation, already coerced to numbers. */
export type Point = {
  label: string;
  value: number;
  /** The x value when it is itself numeric — a scatter plot needs this. */
  xValue: number | null;
};

/** Charts stop being readable long before a result stops being useful. */
export const MAX_POINTS = 30;
export const MAX_SLICES = 8;

export function toNumber(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // Postgres returns numeric and bigint as strings to preserve precision.
    const parsed = Number(value.replace(/,/g, ""));
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toLabel(value: Cell): string {
  if (value === null) return "—";
  if (typeof value === "string") {
    // A full timestamp is noise on an axis when the grouping is by day.
    const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
    return iso ? iso[1] : value;
  }
  return String(value);
}

export function formatValue(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

/** Render a cell for a table, where the raw value is what the reader wants. */
export function formatCell(value: Cell): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Project a result onto the columns a display spec names.
 *
 * Core has already checked that those columns exist and that the measure is
 * numeric, so anything dropped here is a row whose value is null — not a
 * mismatched spec.
 */
export function toPoints(data: ResultData, spec: DisplaySpec): Point[] {
  if (!spec.x || !spec.y) return [];

  return data.rows
    .map((row) => ({
      label: toLabel(row[spec.x as string] ?? null),
      value: toNumber(row[spec.y as string] ?? null),
      xValue: toNumber(row[spec.x as string] ?? null),
    }))
    .filter((point): point is Point => point.value !== null)
    .slice(0, MAX_POINTS);
}

export function columnLabel(data: ResultData, key: string | undefined): string {
  if (!key) return "";
  return data.columns.find((column) => column.key === key)?.label ?? key;
}
