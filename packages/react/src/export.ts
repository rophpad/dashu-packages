import type { ResultData } from "@rophpad/dashu-core";

/**
 * Serialise a result as CSV.
 *
 * Exporting is a permission (`capabilities.export`), enforced by the server.
 * This function only formats what the caller already holds — check the flag
 * before offering the button.
 */
export function toCsv(data: ResultData): string {
  const escape = (value: string): string =>
    // A field containing a delimiter, a quote or a newline has to be quoted,
    // and an embedded quote is doubled.
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [data.columns.map((column) => escape(column.label)).join(",")];

  for (const row of data.rows) {
    lines.push(
      data.columns
        .map((column) => {
          const value = row[column.key];
          return value === null || value === undefined ? "" : escape(String(value));
        })
        .join(","),
    );
  }

  return lines.join("\r\n");
}
