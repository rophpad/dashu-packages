import type { ResultData } from "@rophpad/dashu-core";
import { formatCell } from "./data";
import { token } from "./theme";

export type TableProps = {
  data: ResultData;
  /** Rows rendered before the table scrolls. */
  maxHeight?: number;
};

/**
 * Values are rendered as text nodes, never as markup. Result rows are data from
 * the customer's own database, and a cell containing HTML is a cell containing
 * HTML — not something to interpret.
 */
export function Table({ data, maxHeight = 420 }: TableProps) {
  if (!data.columns.length) return null;

  return (
    <div
      style={{
        overflow: "auto",
        maxHeight,
        border: `1px solid ${token.border}`,
        borderRadius: token.radius,
        fontFamily: token.font,
      }}
    >
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            {data.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{
                  position: "sticky",
                  top: 0,
                  background: token.surface,
                  textAlign: column.type === "number" ? "right" : "left",
                  padding: "8px 12px",
                  borderBottom: `1px solid ${token.border}`,
                  color: token.muted,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={index}>
              {data.columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    padding: "7px 12px",
                    borderBottom: `1px solid ${token.border}`,
                    textAlign: column.type === "number" ? "right" : "left",
                    fontVariantNumeric: column.type === "number" ? "tabular-nums" : undefined,
                    fontFamily: column.type === "number" ? token.mono : undefined,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCell(row[column.key] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {data.truncated && (
        <p style={{ margin: 0, padding: "8px 12px", fontSize: 12, color: token.faint }}>
          Showing the first {data.rows.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}
