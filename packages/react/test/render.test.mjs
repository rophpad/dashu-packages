import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DashuComposer,
  DashuResult,
  Metric,
  Table,
  toCsv,
} from "../dist/index.js";

/**
 * Server rendering is the cheapest way to prove these components mount at all,
 * and it catches the whole class of bug that actually occurs here: geometry
 * computed from data that is empty, flat, negative or missing, where a division
 * by a zero span silently produces NaN in an SVG attribute.
 *
 * Run `npm run build` first — this imports the built output on purpose, so it
 * also proves the bundle a consumer installs is the one that works.
 */

const COLUMNS = [
  { key: "country", label: "country", type: "string" },
  { key: "revenue", label: "revenue", type: "number" },
];

const ROWS = [
  { country: "GB", revenue: "1150.25" },
  { country: "US", revenue: "215.50" },
  { country: "DE", revenue: "45.75" },
];

function answered(display, data = {}, extra = {}) {
  return {
    version: "1",
    answered: true,
    answer: { text: "Revenue by country." },
    data: { columns: COLUMNS, rows: ROWS, truncated: false, ...data },
    display,
    capabilities: { showSql: true, export: true, saveDashboard: true },
    meta: { requestId: "req_1", rowCount: 3, durationMs: 12, dataSource: "main" },
    ...extra,
  };
}

const only = (type, spec = {}) => ({
  primary: { type, x: "country", y: "revenue", ...spec },
  alternatives: [],
});

const DISPLAY_TYPES = [
  "table",
  "metric",
  "bar-chart",
  "line-chart",
  "area-chart",
  "pie-chart",
  "scatter-chart",
];

for (const type of DISPLAY_TYPES) {
  test(`renders ${type}`, () => {
    const html = renderToStaticMarkup(h(DashuResult, { result: answered(only(type)) }));
    assert.ok(html.length > 0);
    // NaN reaches an SVG attribute when a span is zero and nothing guards it.
    assert.ok(!html.includes("NaN"), "geometry produced NaN");
  });
}

test("survives data shapes that break naive geometry", () => {
  const cases = {
    "empty rows": answered(only("bar-chart"), { rows: [] }),
    "single row": answered(only("line-chart"), { rows: [ROWS[0]] }),
    "all zeroes": answered(only("pie-chart"), { rows: ROWS.map((r) => ({ ...r, revenue: "0" })) }),
    "null cells": answered(only("table"), { rows: [{ country: null, revenue: null }] }),
    "flat series": answered(only("line-chart"), { rows: ROWS.map((r) => ({ ...r, revenue: "5" })) }),
    negatives: answered(only("bar-chart"), {
      rows: ROWS.map((r, i) => ({ ...r, revenue: String(-10 * (i + 1)) })),
    }),
    "missing columns": answered(only("bar-chart", { x: "nope", y: "gone" })),
    "non-numeric x on scatter": answered(only("scatter-chart")),
  };

  for (const [name, result] of Object.entries(cases)) {
    const html = renderToStaticMarkup(h(DashuResult, { result }));
    assert.equal(typeof html, "string", name);
    assert.ok(!html.includes("NaN"), `${name} produced NaN`);
  }
});

test("an unanswered result shows its explanation", () => {
  const html = renderToStaticMarkup(
    h(DashuResult, {
      result: { version: "1", answered: false, answer: { text: "No payroll data here." } },
    }),
  );
  assert.match(html, /No payroll data here\./);
});

test("cell and column values are escaped, never markup", () => {
  const html = renderToStaticMarkup(
    h(DashuResult, {
      result: answered(only("table"), {
        columns: [{ key: "c", label: "<img src=x onerror=alert(1)>", type: "string" }],
        rows: [{ c: "<script>alert(1)</script>" }],
      }),
    }),
  );

  // The payload must survive as text, not as an element.
  assert.ok(!html.includes("<script"), "a script element was emitted");
  assert.ok(!html.includes("<img"), "an img element was emitted");
  assert.ok(html.includes("&lt;script&gt;"), "content was not escaped");
});

test("SQL is disclosed only when asked for", () => {
  const result = answered(only("table"), {}, {
    query: { dialect: "postgresql", sql: "SELECT secret FROM vault" },
  });

  assert.match(
    renderToStaticMarkup(h(DashuResult, { result, showSql: true })),
    /SELECT secret FROM vault/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(h(DashuResult, { result })),
    /SELECT secret FROM vault/,
  );
});

test("component overrides replace the built-in renderer", () => {
  const html = renderToStaticMarkup(
    h(DashuResult, {
      result: answered(only("bar-chart")),
      components: { BarChart: () => h("div", null, "custom chart") },
    }),
  );
  assert.match(html, /custom chart/);
});

test("the composer renders its suggestions", () => {
  const html = renderToStaticMarkup(
    h(DashuComposer, { onSubmit: () => {}, suggestions: ["Revenue by country"] }),
  );
  assert.match(html, /Revenue by country/);
});

test("Table and Metric render standalone", () => {
  const data = { columns: COLUMNS, rows: ROWS, truncated: false };
  assert.match(renderToStaticMarkup(h(Table, { data })), /GB/);
  assert.ok(
    renderToStaticMarkup(h(Metric, { data, spec: { type: "metric", y: "revenue" } })).length > 0,
  );
});

test("toCsv escapes delimiters, quotes and newlines", () => {
  const csv = toCsv({ columns: COLUMNS, rows: ROWS, truncated: false });
  assert.equal(csv.split("\r\n")[0], "country,revenue");

  const tricky = toCsv({
    columns: [{ key: "a", label: "a", type: "string" }],
    rows: [{ a: 'x,"y"\nz' }],
    truncated: false,
  });
  assert.ok(tricky.includes('"x,""y""'), tricky);
});

test("null and undefined cells become empty CSV fields, not the string null", () => {
  const csv = toCsv({
    columns: COLUMNS,
    rows: [{ country: null, revenue: undefined }],
    truncated: false,
  });
  assert.equal(csv.split("\r\n")[1], ",");
});
