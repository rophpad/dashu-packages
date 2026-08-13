import { formatValue, type Point } from "../data";
import { token } from "../theme";

const PLOT = { width: 720, height: 180, padX: 4, padY: 14 };

/**
 * Line and area share every calculation and differ only in the fill, so they
 * are one component rather than two that must be kept in step.
 */
export function LineChart({ points, filled = false }: { points: Point[]; filled?: boolean }) {
  const { width, height, padX, padY } = PLOT;

  const values = points.map((point) => point.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  // A flat series has zero span; dividing by it would put every point at NaN.
  const span = max - min || 1;
  const stepX = (width - padX * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((point, index) => ({
    x: padX + index * stepX,
    y: height - padY - ((point.value - min) / span) * (height - padY * 2),
    ...point,
  }));

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x} ${height} L${coords[0].x} ${height} Z`;

  return (
    <div style={{ fontFamily: token.font }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height: 176, width: "100%", overflow: "visible" }}
        preserveAspectRatio="none"
        role="img"
        aria-label={filled ? "Area chart" : "Line chart"}
      >
        <path d={area} fill={token.accent} fillOpacity={filled ? 0.16 : 0.06} />
        <path
          d={line}
          fill="none"
          stroke={token.accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Without this the non-uniform viewBox scaling stretches the stroke.
          vectorEffect="non-scaling-stroke"
        />
        {!filled &&
          coords.map((coord, index) => (
            <circle
              key={index}
              cx={coord.x}
              cy={coord.y}
              r={4}
              fill={token.accent}
              stroke={token.panel}
              strokeWidth={1.5}
            >
              <title>{`${coord.label}: ${formatValue(coord.value)}`}</title>
            </circle>
          ))}
      </svg>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: token.faint,
        }}
      >
        <span>{points[0].label}</span>
        <span style={{ fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(min)} – {formatValue(max)}
        </span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}
