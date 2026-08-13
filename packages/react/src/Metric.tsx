import type { DisplaySpec, ResultData } from "@rophpad/dashu-core";
import { columnLabel, formatValue, toNumber } from "./data";
import { token } from "./theme";

export type MetricProps = {
  data: ResultData;
  spec: DisplaySpec;
};

/** A single number, with the exact value kept available on hover. */
export function Metric({ data, spec }: MetricProps) {
  const key = spec.y ?? data.columns[0]?.key;
  if (!key) return null;

  const raw = data.rows[0]?.[key] ?? null;
  const value = toNumber(raw);
  if (value === null) return null;

  return (
    <div
      style={{
        border: `1px solid ${token.border}`,
        borderRadius: token.radius,
        padding: "18px 20px",
        fontFamily: token.font,
      }}
    >
      <div style={{ fontSize: 12, color: token.muted, marginBottom: 6 }}>
        {spec.title ?? columnLabel(data, key)}
      </div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 600,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
        title={String(raw)}
      >
        {formatValue(value)}
      </div>
    </div>
  );
}
