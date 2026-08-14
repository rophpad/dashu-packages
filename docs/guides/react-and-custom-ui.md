# React and custom UI

`@rophpad/dashu-react` provides client state, a question composer, a result renderer, individual visualizations, data-formatting helpers, CSV serialization, and CSS-variable theming. React `>=18` is a peer dependency.

The package never talks directly to a model or database. `useDashu` posts to your backend route, and the route remains responsible for authentication, actor construction, data-source selection, and policy.

## Complete example

```tsx
"use client";

import {
  DashuComposer,
  DashuResult,
  toCsv,
  useDashu,
} from "@rophpad/dashu-react";

export function Analytics() {
  const {
    ask,
    retry,
    cancel,
    reset,
    result,
    error,
    loading,
    question,
    history,
  } = useDashu({
    endpoint: "/api/dashu/ask",
    keepHistory: true,
    headers: { "X-CSRF-Token": "token-from-your-app" },
    onResult: (next) => console.info("Dashu request", next.meta.requestId),
    onError: (failure) => console.error("Dashu error", failure.code, failure.requestId),
  });

  function downloadCsv() {
    if (!result?.answered || !result.capabilities.export) return;

    const blob = new Blob([toCsv(result.data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dashu-result.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <DashuComposer
        onSubmit={ask}
        onCancel={cancel}
        loading={loading}
        placeholder="Ask about analytics…"
        suggestions={["Revenue by country", "Signups by month"]}
        autoFocus
        className="question-composer"
      />

      {loading && <p>Answering “{question}”…</p>}
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      )}

      {result && (
        <>
          <DashuResult
            result={result}
            allowSwitching
            showSql={result.answered && result.capabilities.showSql}
            className="dashu-result"
          />
          {result.answered && result.capabilities.export && (
            <button type="button" onClick={downloadCsv}>Export CSV</button>
          )}
        </>
      )}

      {history.length > 0 && <button onClick={reset}>New conversation</button>}
    </section>
  );
}
```

## `useDashu`

```ts
const state = useDashu(options);
```

The hook owns request submission, loading state, cancellation, the last question for retry, the latest result/error, and optional follow-up history. It stores no credentials and makes no authorization decisions.

### `UseDashuOptions`

| Option | Type | Default | Behavior |
|---|---|---|---|
| `endpoint` | `string` | `"/api/dashu/ask"` | Route that receives a JSON `POST`. |
| `keepHistory` | `boolean` | `true` | Sends eligible prior turns with later questions and exposes them as `history`. |
| `headers` | `Record<string, string>` | — | Merged into request headers after `Content-Type`; useful for a CSRF token. Do not put database or provider credentials here. |
| `onResult` | `(result: AskResult) => void` | — | Called after a successful HTTP response has set the result. It also runs for `answered: false`. |
| `onError` | `(error: DashuErrorPayload) => void` | — | Called for non-2xx route errors and client/network failures. |

Because `headers`, `onResult`, and `onError` participate in hook callback dependencies, memoize objects and callbacks in a parent if their identity stability matters to your component.

### `UseDashu` return value

| Field | Type | Behavior |
|---|---|---|
| `ask` | `(question: string) => Promise<AskResult \| null>` | Trims and submits a non-empty question. Returns the result or `null` for empty input, cancellation, or failure. A new call aborts any request already in flight. |
| `retry` | `() => Promise<AskResult \| null>` | Re-runs the last non-empty question using the current history. Before any question, it resolves to `null`. |
| `cancel` | `() => void` | Aborts the in-flight fetch and clears `loading`. An abort is not placed in `error` and does not call `onError`. |
| `reset` | `() => void` | Cancels in-flight work and clears result, error, question, history, and the retry question. |
| `result` | `AskResult \| null` | Latest successful route payload. Starting another request does not clear the previous result. |
| `error` | `DashuErrorPayload \| null` | Latest error. Starting a request clears it. |
| `loading` | `boolean` | `true` while the current request is active. Superseded requests cannot clear the newer request's loading state. |
| `question` | `string` | Latest submitted, trimmed question. |
| `history` | `AskTurn[]` | Follow-up turns currently retained by the hook. |

`DashuErrorPayload` has `code: string`, `message: string`, and optional `requestId`. If the response is not valid JSON with an `error` object, or fetch fails for a reason other than abort, the hook uses `{ code: "INTERNAL", message: "Something went wrong. Please try again." }`.

The hook sends:

```jsonc
{
  "question": "Revenue by country",
  "history": [
    { "question": "Revenue this year", "sql": "SELECT …" }
  ]
}
```

`history` is omitted when disabled or empty.

## Follow-up behavior and privacy

A successful turn enters history only when all of these are true:

1. `keepHistory` is enabled;
2. the result is answered;
3. `answer.query?.sql` is present.

The server only returns `query` when policy permits SQL disclosure. Therefore an actor who cannot receive generated SQL cannot seed client follow-up history with this hook. The hook keeps the latest six eligible turns, and the Next.js route and core independently cap accepted history to the latest six turns.

History contains only question/SQL pairs, not result rows. It lives in React state and memory; `reset` clears it, and Dashu does not persist it. A later request sends those pairs to the configured provider as planning context. Set `keepHistory: false` when each question must be independent or prior questions/SQL must not leave the browser again.

## `DashuComposer`

`DashuComposer` is a small controlled-internally question input. It is intentionally replaceable; products with a design system can keep `useDashu` and supply their own form.

### `DashuComposerProps`

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `onSubmit` | `(question: string) => void` | Required | Receives a trimmed, non-empty question. The input clears after form submission. Clicking a suggestion calls this directly. |
| `onCancel` | `() => void` | — | When supplied while `loading`, replaces the submit button with a `Stop` button. |
| `loading` | `boolean` | `false` | Disables the input, suggestions, and submission. |
| `placeholder` | `string` | `"Ask a question about your data…"` | Input placeholder. |
| `suggestions` | `string[]` | `[]` | Clickable prompts shown only while the input value is empty. |
| `autoFocus` | `boolean` | — | Passed to the input's `autoFocus`. |
| `className` | `string` | — | Applied to the component's outer `div`. |

The input has `aria-label="Question"`. Submitting whitespace or submitting while loading does nothing. Suggestion text is passed as supplied; unlike typed input, it is not trimmed by the component, although `useDashu.ask` trims it.

## `DashuResult`

`DashuResult` renders both variants of `AskResult`:

- an unanswerable result renders only `result.answer.text`;
- an answered result renders answer text, a validated display, an optional display switcher, and optional SQL.

Model output is not evaluated as HTML or code. Table values are rendered as React text nodes, and display instructions are a validated `DisplaySpec`.

### `DashuResultProps`

| Prop | Type | Default | Behavior |
|---|---|---|---|
| `result` | `AskResult` | Required | Canonical result returned by core. |
| `components` | `DashuComponents` | `{}` | Per-display renderer overrides. Missing entries use built-ins. |
| `allowSwitching` | `boolean` | `true` | Shows a type switcher when primary plus alternatives contain more than one display. |
| `showSql` | `boolean` | `false` | Shows a `<details>` block only when `result.query` also exists. |
| `className` | `string` | — | Applied to the outer result element. |

The active display initially uses `display.primary`. Selecting a switcher option stores its `DisplayType`; the renderer finds the first current option with that type, otherwise it falls back to the primary display. Buttons expose `aria-pressed`.

Passing `showSql` cannot bypass server policy: the SQL block requires `result.query`, and core omits `query` when `exposeSql` is false. A convenient expression is:

```tsx
<DashuResult
  result={result}
  showSql={result.answered && result.capabilities.showSql}
/>
```

## Override built-in displays

Every override receives the same props:

```ts
type RenderProps = {
  data: ResultData;
  spec: DisplaySpec;
};
```

`DashuComponents` accepts:

- `Table`
- `Metric`
- `BarChart`
- `LineChart`
- `AreaChart`
- `PieChart`
- `ScatterChart`

Each is optional and has type `(props: RenderProps) => ReactNode`.

```tsx
import type { RenderProps } from "@rophpad/dashu-react";

function ProductTable({ data }: RenderProps) {
  return <DataGrid columns={data.columns} rows={data.rows} />;
}

function ProductBarChart({ data, spec }: RenderProps) {
  return <Chart data={data.rows} category={spec.x} measure={spec.y} />;
}

<DashuResult
  result={result}
  components={{
    Table: ProductTable,
    BarChart: ProductBarChart,
  }}
/>;
```

Overrides are invoked as functions by `DashuResult`, rather than instantiated with JSX. They therefore need to obey React's rules for components used in that calling style; keep stateful orchestration outside overrides or return your own component element from the override.

You can also render the result contract yourself and use no bundled result component.

## Individual components and props

The package exports the built-in components for direct composition.

### `Table`

```ts
type TableProps = {
  data: ResultData;
  maxHeight?: number; // default 420
};
```

`Table` returns `null` when there are no columns. It renders a scrollable table with a sticky header, right-aligns numeric columns, formats null as `—`, and shows a truncation message when `data.truncated` is true. Cell content is text, never interpreted markup.

### `Metric`

```ts
type MetricProps = {
  data: ResultData;
  spec: DisplaySpec;
};
```

`Metric` uses `spec.y`, or the first column when `y` is absent, and the first row. It returns `null` when no key or numeric value is available. The compact formatted value is displayed while the exact raw value is retained in the element's `title`.

### `BarChart`

```ts
function BarChart(props: { points: Point[] }): ReactNode;
```

Renders horizontal bars. Labels and formatted values remain text. Positive values are sized relative to the maximum; non-zero values have a visible 1.5% floor.

### `LineChart`

```ts
function LineChart(props: {
  points: Point[];
  filled?: boolean; // default false
}): ReactNode;
```

`filled: true` produces the built-in area-chart appearance. It renders an SVG line/area plus first/last labels and the numeric range.

### `PieChart`

```ts
function PieChart(props: { points: Point[] }): ReactNode;
```

Points are sorted descending. More than eight points are reduced to the seven largest plus an `Other (n)` slice. The chart returns `null` when the total is not positive. Its legend includes label, value, and percentage so color is not the only identifier.

### `ScatterChart`

```ts
function ScatterChart(props: {
  points: Point[];
  xLabel?: string;
  yLabel?: string;
}): ReactNode;
```

Plots numeric `xValue` and `value` fields and uses optional axis labels in point titles.

The chart components expect already projected `Point[]`; use `toPoints(data, spec)` when composing them directly.

## Data helpers

All of these are exported from `@rophpad/dashu-react`:

| Helper | Behavior |
|---|---|
| `toNumber(cell)` | Returns finite numbers directly; parses non-empty strings after removing commas; otherwise returns `null`. PostgreSQL `numeric` and `bigint` commonly arrive as strings. |
| `toLabel(cell)` | Null becomes `—`; ISO timestamps are shortened to the `YYYY-MM-DD` prefix; other values become strings. |
| `formatValue(number)` | Uses `B`, `M`, or `K` abbreviations at 1 billion, 1 million, and 10 thousand; otherwise locale-formats integers or uses two decimal places. |
| `formatCell(cell)` | Null becomes `—`, booleans become `true`/`false`, and other cells use `String`. |
| `toPoints(data, spec)` | Projects `spec.x`/`spec.y`, drops non-numeric measures, and returns at most 30 points. Returns `[]` without both axes. |
| `columnLabel(data, key)` | Finds the result column label, falls back to the key, or returns an empty string without a key. |
| `seriesColor(index)` | Resolves one of eight CSS series variables, cycling by index. |
| `token` | Exposes the CSS-variable expressions used by built-ins. |

`Point` is `{ label: string; value: number; xValue: number | null }`.

## Theme the built-ins

The components use inline styles whose values read CSS custom properties. No stylesheet is required. Define variables on any ancestor:

```css
.analytics-panel {
  --dashu-fg: #111827;
  --dashu-muted: #6b7280;
  --dashu-faint: #9ca3af;
  --dashu-border: #e5e7eb;
  --dashu-surface: #f9fafb;
  --dashu-panel: #ffffff;
  --dashu-accent: #2563eb;
  --dashu-radius: 10px;
  --dashu-font: Inter, system-ui, sans-serif;
  --dashu-font-mono: "JetBrains Mono", monospace;

  --dashu-s1: #2563eb;
  --dashu-s2: #16a34a;
  --dashu-s3: #ea580c;
  --dashu-s4: #7c3aed;
  --dashu-s5: #db2777;
  --dashu-s6: #0891b2;
  --dashu-s7: #65a30d;
  --dashu-s8: #71717a;
}
```

Each token also recognizes the legacy `--askdb-*` equivalent before using its built-in fallback. The complete current contract is:

| Variable | Built-in fallback |
|---|---|
| `--dashu-fg` | `currentColor` |
| `--dashu-muted` | `#6b7280` |
| `--dashu-faint` | `#9ca3af` |
| `--dashu-border` | `rgba(128,128,128,0.25)` |
| `--dashu-surface` | `rgba(128,128,128,0.06)` |
| `--dashu-panel` | `transparent` |
| `--dashu-accent` | `#2a78d6` |
| `--dashu-radius` | `8px` |
| `--dashu-font` | `inherit` |
| `--dashu-font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` |
| `--dashu-s1` … `--dashu-s8` | Fixed eight-color palette exported through `seriesColor` |

Use `className` on `DashuComposer` and `DashuResult` to establish a theme scope or add layout styles. Individual built-ins do not expose `className`; use a wrapper, an override, or your own component when you need deeper structural control.

## CSV export

`toCsv(data: ResultData): string` serializes column labels followed by result rows in column order. It uses commas and CRLF row endings. Fields containing commas, quotes, CR, or LF are quoted, and embedded quotes are doubled. Null and undefined cells become empty fields.

`toCsv` only formats data already held by the caller; it does not enforce export permission. Offer an export action only when the answered result says `result.capabilities.export === true`.

A reusable browser helper:

```ts
import { toCsv, type ResultData } from "@rophpad/dashu-react";

export function saveCsv(data: ResultData, filename = "dashu-result.csv") {
  const blob = new Blob([toCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

## Build a completely custom UI

Keep `useDashu` if you want its request lifecycle but not the bundled visuals:

```tsx
const { ask, result, error, loading, cancel } = useDashu();

return (
  <ProductQuestionForm onAsk={ask} onCancel={cancel} busy={loading}>
    {error && <ProductError code={error.code} requestId={error.requestId} />}
    {result?.answered && (
      <ProductVisualization
        data={result.data}
        display={result.display.primary}
        canExport={result.capabilities.export}
      />
    )}
    {result && !result.answered && <p>{result.answer.text}</p>}
  </ProductQuestionForm>
);
```

Or skip the hook and call your route yourself. Preserve these route expectations if you use `dashuRoute`: send JSON with `question` and optional shape-checked `history`, handle the structured `{ error: { code, message, requestId? } }` response, and propagate cancellation with an `AbortSignal` if abandoned requests should stop provider and database work.

## UI security checklist

- Never send provider keys or database credentials through hook `headers`.
- Do not treat hiding a button as authorization; server policy determines SQL, export, and save capabilities.
- Check `result.answered` before reading `data`, `display`, or `capabilities`.
- Check `result.query` before reading SQL; it is intentionally optional.
- Render result cells as data, not HTML. The built-in `Table` already does this.
- Treat question text and generated SQL as potentially sensitive if you log `onResult`, persist answers, or keep follow-up history.
