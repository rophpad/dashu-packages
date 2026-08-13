import { MAX_SLICES, formatValue, type Point } from "../data";
import { seriesColor, token } from "../theme";

function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
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
    "Z",
  ].join(" ");
}

/**
 * A legend carries the label and the value as text, so a slice is never
 * identified by colour alone.
 */
export function PieChart({ points }: { points: Point[] }) {
  // Too many slices is unreadable; roll the tail into one "Other".
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const slices =
    sorted.length > MAX_SLICES
      ? [
          ...sorted.slice(0, MAX_SLICES - 1),
          {
            label: `Other (${sorted.length - MAX_SLICES + 1})`,
            value: sorted.slice(MAX_SLICES - 1).reduce((sum, point) => sum + point.value, 0),
            xValue: null,
          },
        ]
      : sorted;

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return null;

  const size = 168;
  const centre = size / 2;
  const outer = 78;
  const inner = 46;

  let angle = -Math.PI / 2; // start at twelve o'clock
  const wedges = slices.map((slice, index) => {
    const start = angle;
    angle += (slice.value / total) * Math.PI * 2;
    return { ...slice, start, end: angle, fill: seriesColor(index) };
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "16px 24px",
        fontFamily: token.font,
      }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ height: 176, width: 176, flexShrink: 0 }}
        role="img"
        aria-label="Pie chart"
      >
        {wedges.length === 1 ? (
          // A single wedge spans a full turn, where the arc start and end
          // coincide and the path collapses. A stroked circle is the same ring.
          <circle
            cx={centre}
            cy={centre}
            r={(outer + inner) / 2}
            fill="none"
            stroke={wedges[0].fill}
            strokeWidth={outer - inner}
          />
        ) : (
          wedges.map((wedge, index) => (
            <path
              key={index}
              d={arcPath(centre, centre, outer, inner, wedge.start, wedge.end)}
              fill={wedge.fill}
              stroke={token.panel}
              strokeWidth={1.5}
            >
              <title>
                {`${wedge.label}: ${formatValue(wedge.value)} (${((wedge.value / total) * 100).toFixed(1)}%)`}
              </title>
            </path>
          ))
        )}

        <text
          x={centre}
          y={centre - 2}
          textAnchor="middle"
          style={{ fontSize: 15, fontWeight: 500, fill: "currentColor", fontVariantNumeric: "tabular-nums" }}
        >
          {formatValue(total)}
        </text>
        <text
          x={centre}
          y={centre + 13}
          textAnchor="middle"
          style={{ fontSize: 9, fill: "currentColor", opacity: 0.5 }}
        >
          total
        </text>
      </svg>

      <ul style={{ flex: 1, minWidth: 0, margin: 0, padding: 0, listStyle: "none" }}>
        {wedges.map((wedge, index) => (
          <li
            key={index}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}
          >
            <span
              style={{ height: 10, width: 10, flexShrink: 0, borderRadius: 2, background: wedge.fill }}
            />
            <span
              title={wedge.label}
              style={{
                flex: 1,
                minWidth: 0,
                color: token.muted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {wedge.label}
            </span>
            <span style={{ flexShrink: 0, fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }}>
              {formatValue(wedge.value)}
            </span>
            <span
              style={{
                width: 46,
                flexShrink: 0,
                textAlign: "right",
                color: token.faint,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {((wedge.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
