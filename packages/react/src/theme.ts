/**
 * Theming contract.
 *
 * The package ships inline styles that read CSS custom properties with
 * fallbacks, so it renders correctly with no stylesheet at all and inherits the
 * host's palette the moment those variables are defined. That keeps the package
 * free of a CSS build step without forcing its own look on a product that
 * already has one.
 *
 * Override any of these on an ancestor element:
 *
 * ```css
 * .my-admin {
 *   --dashu-accent: #2a78d6;
 *   --dashu-fg: #111;
 *   --dashu-muted: #666;
 *   --dashu-border: #e5e5e5;
 *   --dashu-surface: #fafafa;
 * }
 * ```
 */
export const token = {
  fg: "var(--dashu-fg, var(--askdb-fg, currentColor))",
  muted: "var(--dashu-muted, var(--askdb-muted, #6b7280))",
  faint: "var(--dashu-faint, var(--askdb-faint, #9ca3af))",
  border: "var(--dashu-border, var(--askdb-border, rgba(128,128,128,0.25)))",
  surface: "var(--dashu-surface, var(--askdb-surface, rgba(128,128,128,0.06)))",
  panel: "var(--dashu-panel, var(--askdb-panel, transparent))",
  accent: "var(--dashu-accent, var(--askdb-accent, #2a78d6))",
  radius: "var(--dashu-radius, var(--askdb-radius, 8px))",
  font: "var(--dashu-font, var(--askdb-font, inherit))",
  mono: "var(--dashu-font-mono, var(--askdb-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace))",
} as const;

/**
 * Categorical series colours in fixed order, never cycled by data value — a
 * slice keeps its colour regardless of how many others are present.
 */
export function seriesColor(index: number): string {
  const slot = (index % 8) + 1;
  return `var(--dashu-s${slot}, var(--askdb-s${slot}, ${FALLBACK_SERIES[index % 8]}))`;
}

const FALLBACK_SERIES = [
  "#2a78d6",
  "#3f9e6b",
  "#c9762f",
  "#8a5cd1",
  "#c94f6d",
  "#2f9ab0",
  "#8a8f3a",
  "#7a7a85",
];
