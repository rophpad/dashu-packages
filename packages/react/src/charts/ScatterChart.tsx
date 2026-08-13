import { formatValue, type Point } from "../data";
import { token } from "../theme";

const PLOT = { width: 720, height: 180, padX: 10, padY: 14 };

/**
 * Both axes are numeric here — core only proposes a scatter plot when the
 * category column parses as numbers, so `xValue` is never null in practice.
 */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
}: {
  points: Point[];
  xLabel?: string;
  yLabel?: string;
}) {
  const { width, height, padX, padY } = PLOT;

  const xs = points.map((point) => point.xValue ?? 0);
  const ys = points.map((point) => point.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const coords = points.map((point) => ({
    cx: padX + (((point.xValue ?? 0) - xMin) / xSpan) * (width - padX * 2),
    cy: height - padY - ((point.value - yMin) / ySpan) * (height - padY * 2),
    ...point,
  }));

  return (
    <div style={{ fontFamily: token.font }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height: 176, width: "100%", overflow: "visible" }}
        preserveAspectRatio="none"
        role="img"
        aria-label="Scatter plot"
      >
        <line
          x1={0}
          y1={height - padY}
          x2={width}
          y2={height - padY}
          stroke={token.border}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {coords.map((coord, index) => (
          <circle key={index} cx={coord.cx} cy={coord.cy} r={3} fill={token.accent}>
            <title>
              {`${xLabel ?? "x"} ${coord.label} · ${yLabel ?? "y"} ${formatValue(coord.value)}`}
            </title>
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
        <span style={{ fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(xMin)}
        </span>
        <span>{xLabel ? `${xLabel} →` : "→"}</span>
        <span style={{ fontFamily: token.mono, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(xMax)}
        </span>
      </div>
    </div>
  );
}
