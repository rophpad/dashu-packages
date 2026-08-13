import * as react from 'react';
import { ReactNode } from 'react';
import { ResultData, DisplaySpec, AskResult, AskTurn, Cell } from '@rophpad/dashu-core';
export { AskAnswered, AskResult, AskUnanswerable, Cell, DisplayPlan, DisplaySpec, DisplayType, ResultColumn, ResultData } from '@rophpad/dashu-core';

/** What a host supplies to render a display type with its own component. */
type RenderProps = {
    data: ResultData;
    spec: DisplaySpec;
};
/**
 * Component overrides. Anything omitted falls back to this package's renderer,
 * so a product can replace only the pieces it already has.
 */
type DashuComponents = {
    Table?: (props: RenderProps) => ReactNode;
    Metric?: (props: RenderProps) => ReactNode;
    BarChart?: (props: RenderProps) => ReactNode;
    LineChart?: (props: RenderProps) => ReactNode;
    AreaChart?: (props: RenderProps) => ReactNode;
    PieChart?: (props: RenderProps) => ReactNode;
    ScatterChart?: (props: RenderProps) => ReactNode;
};
type DashuResultProps = {
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
/**
 * Renders a result from `dashu.ask()`.
 *
 * It reads only the validated contract: the answer text, typed columns and
 * rows, and a display specification core has already checked against the data.
 * Nothing here evaluates markup or code from the model.
 */
declare function DashuResult({ result, components, allowSwitching, showSql, className, }: DashuResultProps): react.JSX.Element;

type DashuComposerProps = {
    onSubmit: (question: string) => void;
    onCancel?: () => void;
    loading?: boolean;
    placeholder?: string;
    /** Shown as clickable prompts when the composer is empty. */
    suggestions?: string[];
    autoFocus?: boolean;
    className?: string;
};
/**
 * A question input.
 *
 * Deliberately small: it submits a string and reports nothing else. Products
 * with a design system are expected to replace it — `useDashu` is the part
 * worth keeping.
 */
declare function DashuComposer({ onSubmit, onCancel, loading, placeholder, suggestions, autoFocus, className, }: DashuComposerProps): react.JSX.Element;

/** The error shape every Dashu route returns. */
type DashuErrorPayload = {
    code: string;
    message: string;
    requestId?: string;
};
type UseDashuOptions = {
    /** The route you mounted `dashuRoute` on. */
    endpoint?: string;
    /**
     * Follow-up context. Only the question and its SQL travel, and only when the
     * server permitted SQL in the first place — a result without `query` cannot
     * contribute a turn.
     */
    keepHistory?: boolean;
    /** Extra headers, e.g. a CSRF token. Credentials belong on the backend. */
    headers?: Record<string, string>;
    onResult?: (result: AskResult) => void;
    onError?: (error: DashuErrorPayload) => void;
};
type UseDashu = {
    ask: (question: string) => Promise<AskResult | null>;
    /** Re-run the last question. */
    retry: () => Promise<AskResult | null>;
    /** Abort the request in flight. */
    cancel: () => void;
    reset: () => void;
    result: AskResult | null;
    error: DashuErrorPayload | null;
    loading: boolean;
    question: string;
    history: AskTurn[];
};
/**
 * Client state for asking questions.
 *
 * This owns the parts every integration would otherwise rewrite: the fetch, the
 * in-flight flag, cancellation, the last question for retry, and follow-up
 * history. It holds no credentials and makes no decisions about permissions —
 * it calls your route, and your route decides what the actor may do.
 */
declare function useDashu(options?: UseDashuOptions): UseDashu;

type TableProps = {
    data: ResultData;
    /** Rows rendered before the table scrolls. */
    maxHeight?: number;
};
/**
 * Values are rendered as text nodes, never as markup. Result rows are data from
 * the customer's own database, and a cell containing HTML is a cell containing
 * HTML — not something to interpret.
 */
declare function Table({ data, maxHeight }: TableProps): react.JSX.Element | null;

type MetricProps = {
    data: ResultData;
    spec: DisplaySpec;
};
/** A single number, with the exact value kept available on hover. */
declare function Metric({ data, spec }: MetricProps): react.JSX.Element | null;

/** One plottable observation, already coerced to numbers. */
type Point = {
    label: string;
    value: number;
    /** The x value when it is itself numeric — a scatter plot needs this. */
    xValue: number | null;
};
declare function toNumber(value: Cell): number | null;
declare function toLabel(value: Cell): string;
declare function formatValue(value: number): string;
/** Render a cell for a table, where the raw value is what the reader wants. */
declare function formatCell(value: Cell): string;
/**
 * Project a result onto the columns a display spec names.
 *
 * Core has already checked that those columns exist and that the measure is
 * numeric, so anything dropped here is a row whose value is null — not a
 * mismatched spec.
 */
declare function toPoints(data: ResultData, spec: DisplaySpec): Point[];
declare function columnLabel(data: ResultData, key: string | undefined): string;

/**
 * Horizontal bars, because category labels are usually words and words read
 * better along the axis they are written on.
 */
declare function BarChart({ points }: {
    points: Point[];
}): react.JSX.Element;

/**
 * Line and area share every calculation and differ only in the fill, so they
 * are one component rather than two that must be kept in step.
 */
declare function LineChart({ points, filled }: {
    points: Point[];
    filled?: boolean;
}): react.JSX.Element;

/**
 * A legend carries the label and the value as text, so a slice is never
 * identified by colour alone.
 */
declare function PieChart({ points }: {
    points: Point[];
}): react.JSX.Element | null;

/**
 * Both axes are numeric here — core only proposes a scatter plot when the
 * category column parses as numbers, so `xValue` is never null in practice.
 */
declare function ScatterChart({ points, xLabel, yLabel, }: {
    points: Point[];
    xLabel?: string;
    yLabel?: string;
}): react.JSX.Element;

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
declare const token: {
    readonly fg: "var(--dashu-fg, var(--askdb-fg, currentColor))";
    readonly muted: "var(--dashu-muted, var(--askdb-muted, #6b7280))";
    readonly faint: "var(--dashu-faint, var(--askdb-faint, #9ca3af))";
    readonly border: "var(--dashu-border, var(--askdb-border, rgba(128,128,128,0.25)))";
    readonly surface: "var(--dashu-surface, var(--askdb-surface, rgba(128,128,128,0.06)))";
    readonly panel: "var(--dashu-panel, var(--askdb-panel, transparent))";
    readonly accent: "var(--dashu-accent, var(--askdb-accent, #2a78d6))";
    readonly radius: "var(--dashu-radius, var(--askdb-radius, 8px))";
    readonly font: "var(--dashu-font, var(--askdb-font, inherit))";
    readonly mono: "var(--dashu-font-mono, var(--askdb-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace))";
};
/**
 * Categorical series colours in fixed order, never cycled by data value — a
 * slice keeps its colour regardless of how many others are present.
 */
declare function seriesColor(index: number): string;

/**
 * Serialise a result as CSV.
 *
 * Exporting is a permission (`capabilities.export`), enforced by the server.
 * This function only formats what the caller already holds — check the flag
 * before offering the button.
 */
declare function toCsv(data: ResultData): string;

export { BarChart, type DashuComponents, DashuComposer, type DashuComposerProps, type DashuErrorPayload, DashuResult, type DashuResultProps, LineChart, Metric, type MetricProps, PieChart, type Point, type RenderProps, ScatterChart, Table, type TableProps, type UseDashu, type UseDashuOptions, columnLabel, formatCell, formatValue, seriesColor, toCsv, toLabel, toNumber, toPoints, token, useDashu };
