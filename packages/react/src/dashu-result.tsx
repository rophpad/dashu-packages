import { useMemo, useState, type ReactNode } from "react";
import type { AskResult, DisplaySpec, DisplayType, ResultData } from "@rophpad/dashu-core";
import { columnLabel, toPoints } from "./data";
import { Table } from "./Table";
import { Metric } from "./Metric";
import { BarChart } from "./charts/BarChart";
import { LineChart } from "./charts/LineChart";
import { PieChart } from "./charts/PieChart";
import { ScatterChart } from "./charts/ScatterChart";
import { token } from "./theme";

/** What a host supplies to render a display type with its own component. */
export type RenderProps = {
  data: ResultData;
  spec: DisplaySpec;
};

/**
 * Component overrides. Anything omitted falls back to this package's renderer,
 * so a product can replace only the pieces it already has.
 */
export type DashuComponents = {
  Table?: (props: RenderProps) => ReactNode;
  Metric?: (props: RenderProps) => ReactNode;
  BarChart?: (props: RenderProps) => ReactNode;
  LineChart?: (props: RenderProps) => ReactNode;
  AreaChart?: (props: RenderProps) => ReactNode;
  PieChart?: (props: RenderProps) => ReactNode;
  ScatterChart?: (props: RenderProps) => ReactNode;
};

export type DashuResultProps = {
  result: AskResult;
  components?: DashuComponents;
  /** Show the display-type switcher when the data supports alternatives. */
  allowSwitching?: boolean;
  /**
   * Render the generated SQL when the server permitted it. Off by default: the
   * server decides whether the SQL may be *sent*, the host decides whether it
   * is shown.
   */
  showSql?: boolean;
  className?: string;
};

const TYPE_LABELS: Record<DisplayType, string> = {
  table: "Table",
  metric: "Metric",
  "bar-chart": "Bar",
  "line-chart": "Line",
  "area-chart": "Area",
  "pie-chart": "Pie",
  "scatter-chart": "Scatter",
};

function Display({
  data,
  spec,
  components,
}: {
  data: ResultData;
  spec: DisplaySpec;
  components: DashuComponents;
}) {
  const points = useMemo(() => toPoints(data, spec), [data, spec]);
  const xLabel = columnLabel(data, spec.x);
  const yLabel = columnLabel(data, spec.y);

  switch (spec.type) {
    case "metric":
      return components.Metric
        ? components.Metric({ data, spec })
        : <Metric data={data} spec={spec} />;

    case "bar-chart":
      return components.BarChart
        ? components.BarChart({ data, spec })
        : <BarChart points={points} />;

    case "line-chart":
      return components.LineChart
        ? components.LineChart({ data, spec })
        : <LineChart points={points} />;

    case "area-chart":
      return components.AreaChart
        ? components.AreaChart({ data, spec })
        : <LineChart points={points} filled />;

    case "pie-chart":
      return components.PieChart
        ? components.PieChart({ data, spec })
        : <PieChart points={points} />;

    case "scatter-chart":
      return components.ScatterChart
        ? components.ScatterChart({ data, spec })
        : <ScatterChart points={points} xLabel={xLabel} yLabel={yLabel} />;

    case "table":
    default:
      return components.Table ? components.Table({ data, spec }) : <Table data={data} />;
  }
}

/**
 * Renders a result from `dashu.ask()`.
 *
 * It reads only the validated contract: the answer text, typed columns and
 * rows, and a display specification core has already checked against the data.
 * Nothing here evaluates markup or code from the model.
 */
export function DashuResult({
  result,
  components = {},
  allowSwitching = true,
  showSql = false,
  className,
}: DashuResultProps) {
  const [override, setOverride] = useState<DisplayType | null>(null);

  if (!result.answered) {
    return (
      <div className={className} style={{ fontFamily: token.font, color: token.muted, fontSize: 14 }}>
        {result.answer.text}
      </div>
    );
  }

  const { data, display } = result;
  const options: DisplaySpec[] = [display.primary, ...display.alternatives];
  const active = options.find((option) => option.type === override) ?? display.primary;

  return (
    <div className={className} style={{ fontFamily: token.font }}>
      {result.answer.text && (
        <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }}>{result.answer.text}</p>
      )}

      <figure style={{ margin: 0 }}>
        {(active.title || (allowSwitching && options.length > 1)) && (
          <figcaption
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 500, color: token.muted }}>
              {active.title ?? ""}
            </span>

            {allowSwitching && options.length > 1 && (
              <span
                style={{
                  display: "inline-flex",
                  gap: 2,
                  padding: 2,
                  borderRadius: token.radius,
                  border: `1px solid ${token.border}`,
                }}
              >
                {options.map((option) => {
                  const selected = option.type === active.type;
                  return (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => setOverride(option.type)}
                      aria-pressed={selected}
                      style={{
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                        font: "inherit",
                        fontFamily: token.font,
                        background: selected ? token.accent : "transparent",
                        color: selected ? "#fff" : token.muted,
                      }}
                    >
                      {TYPE_LABELS[option.type]}
                    </button>
                  );
                })}
              </span>
            )}
          </figcaption>
        )}

        <Display data={data} spec={active} components={components} />
      </figure>

      {/* `result.query` is absent unless server policy allowed it, so this
          cannot reveal SQL the actor was not cleared to see. */}
      {showSql && result.query && (
        <details style={{ marginTop: 12, fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: token.muted }}>
            Generated {result.query.dialect} query
          </summary>
          <pre
            style={{
              margin: "8px 0 0",
              padding: 12,
              overflowX: "auto",
              background: token.surface,
              borderRadius: token.radius,
              fontFamily: token.mono,
              fontSize: 12,
            }}
          >
            {result.query.sql}
          </pre>
        </details>
      )}
    </div>
  );
}
