"use client";

// src/dashu-result.tsx
import { useMemo, useState } from "react";

// src/data.ts
var MAX_POINTS = 30;
var MAX_SLICES = 8;
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function toLabel(value) {
  if (value === null) return "\u2014";
  if (typeof value === "string") {
    const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
    return iso ? iso[1] : value;
  }
  return String(value);
}
function formatValue(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (magnitude >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}
function formatCell(value) {
  if (value === null) return "\u2014";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
function toPoints(data, spec) {
  if (!spec.x || !spec.y) return [];
  return data.rows.map((row) => ({
    label: toLabel(row[spec.x] ?? null),
    value: toNumber(row[spec.y] ?? null),
    xValue: toNumber(row[spec.x] ?? null)
  })).filter((point) => point.value !== null).slice(0, MAX_POINTS);
}
function columnLabel(data, key) {
  if (!key) return "";
  return data.columns.find((column) => column.key === key)?.label ?? key;
}

// src/theme.ts
var token = {
  fg: "var(--dashu-fg, var(--askdb-fg, currentColor))",
  muted: "var(--dashu-muted, var(--askdb-muted, #6b7280))",
  faint: "var(--dashu-faint, var(--askdb-faint, #9ca3af))",
  border: "var(--dashu-border, var(--askdb-border, rgba(128,128,128,0.25)))",
  surface: "var(--dashu-surface, var(--askdb-surface, rgba(128,128,128,0.06)))",
  panel: "var(--dashu-panel, var(--askdb-panel, transparent))",
  accent: "var(--dashu-accent, var(--askdb-accent, #2a78d6))",
  radius: "var(--dashu-radius, var(--askdb-radius, 8px))",
  font: "var(--dashu-font, var(--askdb-font, inherit))",
  mono: "var(--dashu-font-mono, var(--askdb-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace))"
};
function seriesColor(index) {
  const slot = index % 8 + 1;
  return `var(--dashu-s${slot}, var(--askdb-s${slot}, ${FALLBACK_SERIES[index % 8]}))`;
}
var FALLBACK_SERIES = [
  "#2a78d6",
  "#3f9e6b",
  "#c9762f",
  "#8a5cd1",
  "#c94f6d",
  "#2f9ab0",
  "#8a8f3a",
  "#7a7a85"
];

// src/Table.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function Table({ data, maxHeight = 420 }) {
  if (!data.columns.length) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        overflow: "auto",
        maxHeight,
        border: `1px solid ${token.border}`,
        borderRadius: token.radius,
        fontFamily: token.font
      },
      children: [
        /* @__PURE__ */ jsxs("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 13 }, children: [
          /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { children: data.columns.map((column) => /* @__PURE__ */ jsx(
            "th",
            {
              scope: "col",
              style: {
                position: "sticky",
                top: 0,
                background: token.surface,
                textAlign: column.type === "number" ? "right" : "left",
                padding: "8px 12px",
                borderBottom: `1px solid ${token.border}`,
                color: token.muted,
                fontWeight: 500,
                whiteSpace: "nowrap"
              },
              children: column.label
            },
            column.key
          )) }) }),
          /* @__PURE__ */ jsx("tbody", { children: data.rows.map((row, index) => /* @__PURE__ */ jsx("tr", { children: data.columns.map((column) => /* @__PURE__ */ jsx(
            "td",
            {
              style: {
                padding: "7px 12px",
                borderBottom: `1px solid ${token.border}`,
                textAlign: column.type === "number" ? "right" : "left",
                fontVariantNumeric: column.type === "number" ? "tabular-nums" : void 0,
                fontFamily: column.type === "number" ? token.mono : void 0,
                whiteSpace: "nowrap"
              },
              children: formatCell(row[column.key] ?? null)
            },
            column.key
          )) }, index)) })
        ] }),
        data.truncated && /* @__PURE__ */ jsxs("p", { style: { margin: 0, padding: "8px 12px", fontSize: 12, color: token.faint }, children: [
          "Showing the first ",
          data.rows.length.toLocaleString(),
          " rows."
        ] })
      ]
    }
  );
}

// src/Metric.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function Metric({ data, spec }) {
  const key = spec.y ?? data.columns[0]?.key;
  if (!key) return null;
  const raw = data.rows[0]?.[key] ?? null;
  const value = toNumber(raw);
  if (value === null) return null;
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      style: {
        border: `1px solid ${token.border}`,
        borderRadius: token.radius,
        padding: "18px 20px",
        fontFamily: token.font
      },
      children: [
        /* @__PURE__ */ jsx2("div", { style: { fontSize: 12, color: token.muted, marginBottom: 6 }, children: spec.title ?? columnLabel(data, key) }),
        /* @__PURE__ */ jsx2(
          "div",
          {
            style: {
              fontSize: 34,
              fontWeight: 600,
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums"
            },
            title: String(raw),
            children: formatValue(value)
          }
        )
      ]
    }
  );
}

// src/charts/BarChart.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function BarChart({ points }) {
  const max = Math.max(...points.map((point) => point.value), 0);
  return /* @__PURE__ */ jsx3(
    "div",
    {
      style: { display: "flex", flexDirection: "column", gap: 10, fontFamily: token.font },
      role: "img",
      "aria-label": "Bar chart",
      children: points.map((point, index) => /* @__PURE__ */ jsxs3(
        "div",
        {
          style: { display: "flex", alignItems: "center", gap: 12, fontSize: 12 },
          children: [
            /* @__PURE__ */ jsx3(
              "span",
              {
                title: point.label,
                style: {
                  width: 112,
                  flexShrink: 0,
                  textAlign: "right",
                  color: token.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                },
                children: point.label
              }
            ),
            /* @__PURE__ */ jsx3(
              "span",
              {
                style: {
                  position: "relative",
                  height: 8,
                  flex: 1,
                  overflow: "hidden",
                  borderRadius: 999,
                  background: token.surface
                },
                children: /* @__PURE__ */ jsx3(
                  "span",
                  {
                    style: {
                      position: "absolute",
                      insetBlock: 0,
                      left: 0,
                      borderRadius: 999,
                      background: token.accent,
                      // A non-zero floor keeps a small value visible rather than
                      // rendering as nothing at all.
                      width: `${max > 0 ? Math.max(point.value / max * 100, 1.5) : 0}%`
                    }
                  }
                )
              }
            ),
            /* @__PURE__ */ jsx3(
              "span",
              {
                style: {
                  width: 64,
                  flexShrink: 0,
                  textAlign: "right",
                  fontFamily: token.mono,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 500
                },
                children: formatValue(point.value)
              }
            )
          ]
        },
        `${point.label}-${index}`
      ))
    }
  );
}

// src/charts/LineChart.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var PLOT = { width: 720, height: 180, padX: 4, padY: 14 };
function LineChart({ points, filled = false }) {
  const { width, height, padX, padY } = PLOT;
  const values = points.map((point) => point.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = (width - padX * 2) / Math.max(points.length - 1, 1);
  const coords = points.map((point, index) => ({
    x: padX + index * stepX,
    y: height - padY - (point.value - min) / span * (height - padY * 2),
    ...point
  }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x} ${height} L${coords[0].x} ${height} Z`;
  return /* @__PURE__ */ jsxs4("div", { style: { fontFamily: token.font }, children: [
    /* @__PURE__ */ jsxs4(
      "svg",
      {
        viewBox: `0 0 ${width} ${height}`,
        style: { height: 176, width: "100%", overflow: "visible" },
        preserveAspectRatio: "none",
        role: "img",
        "aria-label": filled ? "Area chart" : "Line chart",
        children: [
          /* @__PURE__ */ jsx4("path", { d: area, fill: token.accent, fillOpacity: filled ? 0.16 : 0.06 }),
          /* @__PURE__ */ jsx4(
            "path",
            {
              d: line,
              fill: "none",
              stroke: token.accent,
              strokeWidth: 2,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              vectorEffect: "non-scaling-stroke"
            }
          ),
          !filled && coords.map((coord, index) => /* @__PURE__ */ jsx4(
            "circle",
            {
              cx: coord.x,
              cy: coord.y,
              r: 4,
              fill: token.accent,
              stroke: token.panel,
              strokeWidth: 1.5,
              children: /* @__PURE__ */ jsx4("title", { children: `${coord.label}: ${formatValue(coord.value)}` })
            },
            index
          ))
        ]
      }
    ),
    /* @__PURE__ */ jsxs4(
      "div",
      {
        style: {
          marginTop: 10,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: token.faint
        },
        children: [
          /* @__PURE__ */ jsx4("span", { children: points[0].label }),
          /* @__PURE__ */ jsxs4("span", { style: { fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }, children: [
            formatValue(min),
            " \u2013 ",
            formatValue(max)
          ] }),
          /* @__PURE__ */ jsx4("span", { children: points[points.length - 1].label })
        ]
      }
    )
  ] });
}

// src/charts/PieChart.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function arcPath(cx, cy, outer, inner, start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + outer * Math.cos(start);
  const y0 = cy + outer * Math.sin(start);
  const x1 = cx + outer * Math.cos(end);
  const y1 = cy + outer * Math.sin(end);
  const xi1 = cx + inner * Math.cos(end);
  const yi1 = cy + inner * Math.sin(end);
  const xi0 = cx + inner * Math.cos(start);
  const yi0 = cy + inner * Math.sin(start);
  return [
    `M${x0} ${y0}`,
    `A${outer} ${outer} 0 ${large} 1 ${x1} ${y1}`,
    `L${xi1} ${yi1}`,
    `A${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0}`,
    "Z"
  ].join(" ");
}
function PieChart({ points }) {
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const slices = sorted.length > MAX_SLICES ? [
    ...sorted.slice(0, MAX_SLICES - 1),
    {
      label: `Other (${sorted.length - MAX_SLICES + 1})`,
      value: sorted.slice(MAX_SLICES - 1).reduce((sum, point) => sum + point.value, 0),
      xValue: null
    }
  ] : sorted;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return null;
  const size = 168;
  const centre = size / 2;
  const outer = 78;
  const inner = 46;
  let angle = -Math.PI / 2;
  const wedges = slices.map((slice, index) => {
    const start = angle;
    angle += slice.value / total * Math.PI * 2;
    return { ...slice, start, end: angle, fill: seriesColor(index) };
  });
  return /* @__PURE__ */ jsxs5(
    "div",
    {
      style: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "16px 24px",
        fontFamily: token.font
      },
      children: [
        /* @__PURE__ */ jsxs5(
          "svg",
          {
            viewBox: `0 0 ${size} ${size}`,
            style: { height: 176, width: 176, flexShrink: 0 },
            role: "img",
            "aria-label": "Pie chart",
            children: [
              wedges.length === 1 ? (
                // A single wedge spans a full turn, where the arc start and end
                // coincide and the path collapses. A stroked circle is the same ring.
                /* @__PURE__ */ jsx5(
                  "circle",
                  {
                    cx: centre,
                    cy: centre,
                    r: (outer + inner) / 2,
                    fill: "none",
                    stroke: wedges[0].fill,
                    strokeWidth: outer - inner
                  }
                )
              ) : wedges.map((wedge, index) => /* @__PURE__ */ jsx5(
                "path",
                {
                  d: arcPath(centre, centre, outer, inner, wedge.start, wedge.end),
                  fill: wedge.fill,
                  stroke: token.panel,
                  strokeWidth: 1.5,
                  children: /* @__PURE__ */ jsx5("title", { children: `${wedge.label}: ${formatValue(wedge.value)} (${(wedge.value / total * 100).toFixed(1)}%)` })
                },
                index
              )),
              /* @__PURE__ */ jsx5(
                "text",
                {
                  x: centre,
                  y: centre - 2,
                  textAnchor: "middle",
                  style: { fontSize: 15, fontWeight: 500, fill: "currentColor", fontVariantNumeric: "tabular-nums" },
                  children: formatValue(total)
                }
              ),
              /* @__PURE__ */ jsx5(
                "text",
                {
                  x: centre,
                  y: centre + 13,
                  textAnchor: "middle",
                  style: { fontSize: 9, fill: "currentColor", opacity: 0.5 },
                  children: "total"
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx5("ul", { style: { flex: 1, minWidth: 0, margin: 0, padding: 0, listStyle: "none" }, children: wedges.map((wedge, index) => /* @__PURE__ */ jsxs5(
          "li",
          {
            style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" },
            children: [
              /* @__PURE__ */ jsx5(
                "span",
                {
                  style: { height: 10, width: 10, flexShrink: 0, borderRadius: 2, background: wedge.fill }
                }
              ),
              /* @__PURE__ */ jsx5(
                "span",
                {
                  title: wedge.label,
                  style: {
                    flex: 1,
                    minWidth: 0,
                    color: token.muted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  },
                  children: wedge.label
                }
              ),
              /* @__PURE__ */ jsx5("span", { style: { flexShrink: 0, fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }, children: formatValue(wedge.value) }),
              /* @__PURE__ */ jsxs5(
                "span",
                {
                  style: {
                    width: 46,
                    flexShrink: 0,
                    textAlign: "right",
                    color: token.faint,
                    fontVariantNumeric: "tabular-nums"
                  },
                  children: [
                    (wedge.value / total * 100).toFixed(1),
                    "%"
                  ]
                }
              )
            ]
          },
          index
        )) })
      ]
    }
  );
}

// src/charts/ScatterChart.tsx
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
var PLOT2 = { width: 720, height: 180, padX: 10, padY: 14 };
function ScatterChart({
  points,
  xLabel,
  yLabel
}) {
  const { width, height, padX, padY } = PLOT2;
  const xs = points.map((point) => point.xValue ?? 0);
  const ys = points.map((point) => point.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const coords = points.map((point) => ({
    cx: padX + ((point.xValue ?? 0) - xMin) / xSpan * (width - padX * 2),
    cy: height - padY - (point.value - yMin) / ySpan * (height - padY * 2),
    ...point
  }));
  return /* @__PURE__ */ jsxs6("div", { style: { fontFamily: token.font }, children: [
    /* @__PURE__ */ jsxs6(
      "svg",
      {
        viewBox: `0 0 ${width} ${height}`,
        style: { height: 176, width: "100%", overflow: "visible" },
        preserveAspectRatio: "none",
        role: "img",
        "aria-label": "Scatter plot",
        children: [
          /* @__PURE__ */ jsx6(
            "line",
            {
              x1: 0,
              y1: height - padY,
              x2: width,
              y2: height - padY,
              stroke: token.border,
              strokeWidth: 1,
              vectorEffect: "non-scaling-stroke"
            }
          ),
          coords.map((coord, index) => /* @__PURE__ */ jsx6("circle", { cx: coord.cx, cy: coord.cy, r: 3, fill: token.accent, children: /* @__PURE__ */ jsx6("title", { children: `${xLabel ?? "x"} ${coord.label} \xB7 ${yLabel ?? "y"} ${formatValue(coord.value)}` }) }, index))
        ]
      }
    ),
    /* @__PURE__ */ jsxs6(
      "div",
      {
        style: {
          marginTop: 10,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: token.faint
        },
        children: [
          /* @__PURE__ */ jsx6("span", { style: { fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }, children: formatValue(xMin) }),
          /* @__PURE__ */ jsx6("span", { children: xLabel ? `${xLabel} \u2192` : "\u2192" }),
          /* @__PURE__ */ jsx6("span", { style: { fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }, children: formatValue(xMax) })
        ]
      }
    )
  ] });
}

// src/dashu-result.tsx
import { jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
var TYPE_LABELS = {
  table: "Table",
  metric: "Metric",
  "bar-chart": "Bar",
  "line-chart": "Line",
  "area-chart": "Area",
  "pie-chart": "Pie",
  "scatter-chart": "Scatter"
};
function Display({
  data,
  spec,
  components
}) {
  const points = useMemo(() => toPoints(data, spec), [data, spec]);
  const xLabel = columnLabel(data, spec.x);
  const yLabel = columnLabel(data, spec.y);
  switch (spec.type) {
    case "metric":
      return components.Metric ? components.Metric({ data, spec }) : /* @__PURE__ */ jsx7(Metric, { data, spec });
    case "bar-chart":
      return components.BarChart ? components.BarChart({ data, spec }) : /* @__PURE__ */ jsx7(BarChart, { points });
    case "line-chart":
      return components.LineChart ? components.LineChart({ data, spec }) : /* @__PURE__ */ jsx7(LineChart, { points });
    case "area-chart":
      return components.AreaChart ? components.AreaChart({ data, spec }) : /* @__PURE__ */ jsx7(LineChart, { points, filled: true });
    case "pie-chart":
      return components.PieChart ? components.PieChart({ data, spec }) : /* @__PURE__ */ jsx7(PieChart, { points });
    case "scatter-chart":
      return components.ScatterChart ? components.ScatterChart({ data, spec }) : /* @__PURE__ */ jsx7(ScatterChart, { points, xLabel, yLabel });
    case "table":
    default:
      return components.Table ? components.Table({ data, spec }) : /* @__PURE__ */ jsx7(Table, { data });
  }
}
function DashuResult({
  result,
  components = {},
  allowSwitching = true,
  showSql = false,
  className
}) {
  const [override, setOverride] = useState(null);
  if (!result.answered) {
    return /* @__PURE__ */ jsx7("div", { className, style: { fontFamily: token.font, color: token.muted, fontSize: 14 }, children: result.answer.text });
  }
  const { data, display } = result;
  const options = [display.primary, ...display.alternatives];
  const active = options.find((option) => option.type === override) ?? display.primary;
  return /* @__PURE__ */ jsxs7("div", { className, style: { fontFamily: token.font }, children: [
    result.answer.text && /* @__PURE__ */ jsx7("p", { style: { margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }, children: result.answer.text }),
    /* @__PURE__ */ jsxs7("figure", { style: { margin: 0 }, children: [
      (active.title || allowSwitching && options.length > 1) && /* @__PURE__ */ jsxs7(
        "figcaption",
        {
          style: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 12
          },
          children: [
            /* @__PURE__ */ jsx7("span", { style: { fontSize: 12, fontWeight: 500, color: token.muted }, children: active.title ?? "" }),
            allowSwitching && options.length > 1 && /* @__PURE__ */ jsx7(
              "span",
              {
                style: {
                  display: "inline-flex",
                  gap: 2,
                  padding: 2,
                  borderRadius: token.radius,
                  border: `1px solid ${token.border}`
                },
                children: options.map((option) => {
                  const selected = option.type === active.type;
                  return /* @__PURE__ */ jsx7(
                    "button",
                    {
                      type: "button",
                      onClick: () => setOverride(option.type),
                      "aria-pressed": selected,
                      style: {
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                        font: "inherit",
                        fontFamily: token.font,
                        background: selected ? token.accent : "transparent",
                        color: selected ? "#fff" : token.muted
                      },
                      children: TYPE_LABELS[option.type]
                    },
                    option.type
                  );
                })
              }
            )
          ]
        }
      ),
      /* @__PURE__ */ jsx7(Display, { data, spec: active, components })
    ] }),
    showSql && result.query && /* @__PURE__ */ jsxs7("details", { style: { marginTop: 12, fontSize: 12 }, children: [
      /* @__PURE__ */ jsxs7("summary", { style: { cursor: "pointer", color: token.muted }, children: [
        "Generated ",
        result.query.dialect,
        " query"
      ] }),
      /* @__PURE__ */ jsx7(
        "pre",
        {
          style: {
            margin: "8px 0 0",
            padding: 12,
            overflowX: "auto",
            background: token.surface,
            borderRadius: token.radius,
            fontFamily: token.mono,
            fontSize: 12
          },
          children: result.query.sql
        }
      )
    ] })
  ] });
}

// src/dashu-composer.tsx
import { useState as useState2 } from "react";
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function DashuComposer({
  onSubmit,
  onCancel,
  loading = false,
  placeholder = "Ask a question about your data\u2026",
  suggestions = [],
  autoFocus,
  className
}) {
  const [value, setValue] = useState2("");
  function submit(event) {
    event.preventDefault();
    const question = value.trim();
    if (!question || loading) return;
    onSubmit(question);
    setValue("");
  }
  return /* @__PURE__ */ jsxs8("div", { className, style: { fontFamily: token.font }, children: [
    /* @__PURE__ */ jsxs8("form", { onSubmit: submit, style: { display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ jsx8(
        "input",
        {
          value,
          onChange: (event) => setValue(event.target.value),
          placeholder,
          "aria-label": "Question",
          autoFocus,
          disabled: loading,
          style: {
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            fontSize: 14,
            font: "inherit",
            fontFamily: token.font,
            color: token.fg,
            background: "transparent",
            border: `1px solid ${token.border}`,
            borderRadius: token.radius
          }
        }
      ),
      loading && onCancel ? /* @__PURE__ */ jsx8(
        "button",
        {
          type: "button",
          onClick: onCancel,
          style: {
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            color: token.muted,
            background: "transparent",
            border: `1px solid ${token.border}`,
            borderRadius: token.radius
          },
          children: "Stop"
        }
      ) : /* @__PURE__ */ jsx8(
        "button",
        {
          type: "submit",
          disabled: loading || !value.trim(),
          style: {
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: loading || !value.trim() ? "default" : "pointer",
            opacity: loading || !value.trim() ? 0.5 : 1,
            color: "#fff",
            background: token.accent,
            border: "none",
            borderRadius: token.radius
          },
          children: loading ? "Asking\u2026" : "Ask"
        }
      )
    ] }),
    !value && suggestions.length > 0 && /* @__PURE__ */ jsx8("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }, children: suggestions.map((suggestion) => /* @__PURE__ */ jsx8(
      "button",
      {
        type: "button",
        onClick: () => onSubmit(suggestion),
        disabled: loading,
        style: {
          padding: "5px 10px",
          fontSize: 12,
          cursor: "pointer",
          color: token.muted,
          background: token.surface,
          border: `1px solid ${token.border}`,
          borderRadius: 999
        },
        children: suggestion
      },
      suggestion
    )) })
  ] });
}

// src/use-dashu.ts
import { useCallback, useRef, useState as useState3 } from "react";
var GENERIC_ERROR = {
  code: "INTERNAL",
  message: "Something went wrong. Please try again."
};
function useDashu(options = {}) {
  const {
    endpoint = "/api/dashu/ask",
    keepHistory = true,
    headers,
    onResult,
    onError
  } = options;
  const [result, setResult] = useState3(null);
  const [error, setError] = useState3(null);
  const [loading, setLoading] = useState3(false);
  const [question, setQuestion] = useState3("");
  const [history, setHistory] = useState3([]);
  const controller = useRef(null);
  const lastQuestion = useRef("");
  const historyRef = useRef([]);
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
  }, []);
  const send = useCallback(
    async (asked) => {
      const trimmed = asked.trim();
      if (!trimmed) return null;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      lastQuestion.current = trimmed;
      setQuestion(trimmed);
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            question: trimmed,
            ...keepHistory && historyRef.current.length ? { history: historyRef.current } : {}
          }),
          signal: abort.signal
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const failure = payload && typeof payload === "object" && "error" in payload ? payload.error ?? GENERIC_ERROR : GENERIC_ERROR;
          setError(failure);
          onError?.(failure);
          return null;
        }
        const answer = payload;
        setResult(answer);
        if (keepHistory && answer.answered && answer.query?.sql) {
          const next = [...historyRef.current, { question: trimmed, sql: answer.query.sql }].slice(-6);
          historyRef.current = next;
          setHistory(next);
        }
        onResult?.(answer);
        return answer;
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return null;
        setError(GENERIC_ERROR);
        onError?.(GENERIC_ERROR);
        return null;
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setLoading(false);
        }
      }
    },
    [endpoint, headers, keepHistory, onError, onResult]
  );
  const reset = useCallback(() => {
    cancel();
    setResult(null);
    setError(null);
    setQuestion("");
    setHistory([]);
    historyRef.current = [];
    lastQuestion.current = "";
  }, [cancel]);
  return {
    ask: send,
    retry: useCallback(() => send(lastQuestion.current), [send]),
    cancel,
    reset,
    result,
    error,
    loading,
    question,
    history
  };
}

// src/export.ts
function toCsv(data) {
  const escape = (value) => (
    // A field containing a delimiter, a quote or a newline has to be quoted,
    // and an embedded quote is doubled.
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  );
  const lines = [data.columns.map((column) => escape(column.label)).join(",")];
  for (const row of data.rows) {
    lines.push(
      data.columns.map((column) => {
        const value = row[column.key];
        return value === null || value === void 0 ? "" : escape(String(value));
      }).join(",")
    );
  }
  return lines.join("\r\n");
}
export {
  BarChart,
  DashuComposer,
  DashuResult,
  LineChart,
  Metric,
  PieChart,
  ScatterChart,
  Table,
  columnLabel,
  formatCell,
  formatValue,
  seriesColor,
  toCsv,
  toLabel,
  toNumber,
  toPoints,
  token,
  useDashu
};
//# sourceMappingURL=index.js.map