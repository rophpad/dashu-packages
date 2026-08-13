import { formatValue, type Point } from "../data";
import { token } from "../theme";

/**
 * Horizontal bars, because category labels are usually words and words read
 * better along the axis they are written on.
 */
export function BarChart({ points }: { points: Point[] }) {
  const max = Math.max(...points.map((point) => point.value), 0);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: token.font }}
      role="img"
      aria-label="Bar chart"
    >
      {points.map((point, index) => (
        <div
          key={`${point.label}-${index}`}
          style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}
        >
          <span
            title={point.label}
            style={{
              width: 112,
              flexShrink: 0,
              textAlign: "right",
              color: token.muted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {point.label}
          </span>
          <span
            style={{
              position: "relative",
              height: 8,
              flex: 1,
              overflow: "hidden",
              borderRadius: 999,
              background: token.surface,
            }}
          >
            <span
              style={{
                position: "absolute",
                insetBlock: 0,
                left: 0,
                borderRadius: 999,
                background: token.accent,
                // A non-zero floor keeps a small value visible rather than
                // rendering as nothing at all.
                width: `${max > 0 ? Math.max((point.value / max) * 100, 1.5) : 0}%`,
              }}
            />
          </span>
          <span
            style={{
              width: 64,
              flexShrink: 0,
              textAlign: "right",
              fontFamily: token.mono,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
            }}
          >
            {formatValue(point.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
