# Result contract

Dashu questions and stored-query runs use the versioned `AskResult` contract exported by `@rophpad/dashu-core` and re-exported by `@rophpad/dashu-react`. The current version literal is `"1"`.

Source contracts: [`packages/core/src/types.ts`](../../packages/core/src/types.ts). Conversion and display validation: [`packages/core/src/result.ts`](../../packages/core/src/result.ts), [`packages/core/src/display-spec.ts`](../../packages/core/src/display-spec.ts).

## `AskResult`

```ts
type AskResult = AskAnswered | AskUnanswerable;
```

`answered` is the discriminant. Always narrow on it before accessing data, display, capabilities, or query:

```ts
const result = await dashu.ask(request);

if (!result.answered) {
  console.info(result.answer.text);
  return;
}

console.log(result.data.rows, result.display.primary);
if (result.capabilities.export) download(toCsv(result.data));
```

An unanswerable result is not an error: the model understood the question but the approved schema did not contain enough information. Transport/authorization/provider/query failures reject the core promise and become the error envelope described in [Errors and statuses](./errors.md) when using the Next adapter.

## `AskAnswered`

```ts
type AskAnswered = {
  version: "1";
  answered: true;
  answer: { text: string };
  data: ResultData;
  display: DisplayPlan;
  capabilities: AskCapabilities;
  query?: { dialect: string; sql: string };
  meta: AskMeta;
};

type AskCapabilities = {
  showSql: boolean;
  export: boolean;
  saveDashboard: boolean;
};

type AskMeta = {
  requestId: string;
  rowCount: number;
  durationMs: number;
  dataSource: string;
  provider: string;
};
```

- `answer.text` is the model's bounded plain-text explanation. `run()` deliberately returns an empty string.
- `data` contains normalized columns and rows.
- `display` has already been checked against returned data; renderers should not use the model's raw suggestion.
- `capabilities` reflects resolved server policy. It is guidance for UI actions, not client-side authorization.
- `query` is omitted unless resolved policy enables SQL disclosure. `capabilities.showSql` mirrors that decision. `query.sql` is the cleaned original statement, not the adapter's outer-limit wrapper.
- `meta.rowCount` equals `data.rows.length`; `durationMs` is wall-clock milliseconds measured by core; `provider` is `DashuAiProvider.mode`, not its human-readable name.
- `requestId` is caller-supplied or generated as a `req_...` string. Treat its exact generated shape as opaque.

Example:

```json
{
  "version": "1",
  "answered": true,
  "answer": { "text": "Revenue increased across the three reported months." },
  "data": {
    "columns": [
      { "key": "month", "label": "month", "type": "date" },
      { "key": "revenue", "label": "revenue", "type": "number" }
    ],
    "rows": [
      { "month": "2026-01-01", "revenue": "12500.25" },
      { "month": "2026-02-01", "revenue": "14900.00" }
    ],
    "truncated": false
  },
  "display": {
    "primary": { "type": "line-chart", "title": "Monthly revenue", "x": "month", "y": "revenue" },
    "alternatives": [
      { "type": "bar-chart", "x": "month", "y": "revenue" },
      { "type": "area-chart", "x": "month", "y": "revenue" },
      { "type": "table" }
    ]
  },
  "capabilities": { "showSql": false, "export": true, "saveDashboard": false },
  "meta": {
    "requestId": "req_example",
    "rowCount": 2,
    "durationMs": 184,
    "dataSource": "analytics",
    "provider": "openrouter"
  }
}
```

## `AskUnanswerable`

```ts
type AskUnanswerable = {
  version: "1";
  answered: false;
  answer: { text: string };
  meta: Pick<AskMeta, "requestId" | "durationMs" | "dataSource" | "provider">;
};
```

It has no `data`, `display`, `capabilities`, `query`, or `rowCount`. `answer.text` is the model explanation, falling back to `That question cannot be answered from this database.` when empty.

```json
{
  "version": "1",
  "answered": false,
  "answer": { "text": "The approved schema does not include marketing spend." },
  "meta": {
    "requestId": "req_example",
    "durationMs": 91,
    "dataSource": "analytics",
    "provider": "managed"
  }
}
```

## Data contract

```ts
type Cell = string | number | boolean | null;
type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

type ResultColumn = {
  key: string;
  label: string;
  type: ColumnType;
};

type ResultData = {
  columns: ResultColumn[];
  rows: Record<string, Cell>[];
  truncated: boolean;
};
```

`columns` preserves query order. `label` is the database column name. `key` is unique within the result and is what object rows and display axes reference.

### Data conversion

`toResultData(result, limit)` converts adapter `QueryResult` (`columns: string[]`, positional `rows: Cell[][]`) as follows:

1. Empty column names become `column_1`, `column_2`, and so on.
2. Duplicate base names get `_2`, `_3`, etc. For `['name', 'name']`, keys are `name` and `name_2` while both labels remain `name`.
3. Missing/`undefined` positional values become `null`; extra row values beyond the column list are ignored.
4. Type inference samples only the first 50 rows and ignores nulls.
5. `truncated` is `rows.length >= limit`.

That truncation test is conservative. The PostgreSQL adapter fetches at most exactly `limit`, not `limit + 1`, so `true` means the result reached the cap; it does not prove another row existed.

### Type inference

Inference is value-based and dialect-independent:

- all-null/no sampled values → `unknown`;
- all non-null booleans → `boolean`;
- strings beginning `YYYY-MM-DD` followed by `T` or end-of-string → `date`, if every non-null value matches;
- finite-looking decimal/integer strings matching `^-?\d+(\.\d+)?$` and numbers → `number`, if every non-null value is numeric;
- remaining strings/mixed scalar shapes → `string`;
- an unexpected non-`Cell` runtime value → `unknown`.

PostgreSQL numeric and bigint values intentionally remain strings to avoid precision loss, but are inferred as `number` when they match the numeric pattern. Scientific notation, leading plus signs, `.5`, `1.`, comma-separated numbers, `NaN`, and `Infinity` are not inferred as numeric by core. Later React `toNumber` is more permissive (for example, it removes commas), so helper conversion and core metadata are not identical.

Because only 50 rows are sampled, later values cannot change `ResultColumn.type`.

## Display contract

```ts
type DisplayType =
  | "table"
  | "metric"
  | "bar-chart"
  | "line-chart"
  | "area-chart"
  | "pie-chart"
  | "scatter-chart";

type DisplaySpec = {
  type: DisplayType;
  title?: string;
  x?: string;
  y?: string;
};

type DisplayPlan = {
  primary: DisplaySpec;
  alternatives: DisplaySpec[];
};
```

The contract is declarative and contains no HTML or executable code. `x`/`y` are `ResultColumn.key` values after resolution, not arbitrary expressions. `table` generally has neither. `metric` uses `y`; charts use both.

### Display resolution

`resolveDisplay(suggestion, data)` applies these rules:

- Titles have ASCII control characters replaced with spaces, whitespace collapsed, and are omitted when empty. Titles over 120 characters are cut and suffixed with `…`.
- No columns or no rows always produces a table with no alternatives.
- Axis names resolve by exact key first, then by the first matching label. This permits a model alias to resolve after duplicate keys are suffixed.
- A metric requires exactly one row and a numeric `y`; when `y` is absent/unresolved it tries the first column. A valid metric offers table as its only alternative.
- Charts require 2–60 rows, a present x column, and a numeric y column.
- A column typed `number` is numeric. An `unknown` column is accepted only when at least two row values parse as finite numbers. Other declared types are not reconsidered.
- Bar, line, and area are supported for every otherwise-plottable result.
- Pie additionally requires every row's y value to be numeric, all values nonnegative, and at least one positive value.
- Scatter additionally requires numeric x.
- If the suggested chart is unsupported but the data is otherwise plottable, primary falls back to `bar-chart`.
- Alternatives contain every other supported chart in fixed order (bar, line, area, pie, scatter), followed by table. Alternative specs omit the primary title.
- An invalid/non-chart suggestion resolves to table with no alternatives.

The React renderer projects at most 30 points even though core accepts up to 60 chart rows. Its pie renderer combines more than eight projected points into an `Other` slice.

## Input-side related types

These are not response fields, but define context used to produce a result:

```ts
type AskTurn = { question: string; sql: string };
type SemanticLayer = { terms: Record<string, string>; notes: string[] };
```

Core sends at most the last six history turns. The Next route also filters body history to objects with string `question` and `sql`, then keeps six. The React hook can only add history when an answered result includes disclosed SQL.

## Compatibility guidance

- Branch on `version` before consuming a persisted or remote result, even though only `"1"` exists today.
- Branch on `answered`; do not infer answerability from row count or answer text.
- Iterate `columns` to preserve order and use `column.key` to read each row.
- Treat unknown additional object fields as forward-compatible additions.
- Do not use capability flags as a substitute for server authorization. The server controls whether SQL is included and must authorize export/dashboard operations independently.
- Render answer text, labels, titles, SQL, and cells as text. The bundled React components do this and never evaluate model/database content as markup.
