# Semantic layer, follow-ups, and saved queries

Dashu can query a physical schema without extra vocabulary, but business terms are often ambiguous. A semantic layer tells the planner how your organization defines those terms.

## Semantic layer shape

```ts
type SemanticLayer = {
  terms: Record<string, string>;
  notes: string[];
};
```

Example:

```ts
const semantic = {
  terms: {
    revenue: "Sum of analytics.orders.net_total, excluding refunded orders",
    active_customer: "A customer with status = 'active' and deleted_at IS NULL",
    conversion_rate: "paid_orders divided by completed_checkouts",
  },
  notes: [
    "All timestamps are stored in UTC.",
    "Use analytics.calendar_months when a report must include empty months.",
    "Never infer customer lifetime value from current subscription price.",
  ],
};
```

The semantic layer is prompt context, not an authorization boundary. Terms should refer only to objects already available in the filtered schema. Database grants and schema policy remain authoritative.

## Writing useful terms

Good definitions are:

- precise about included/excluded records;
- explicit about time zone and date boundaries;
- tied to approved tables, views, or expressions;
- stable enough to use across reports;
- free of secrets and personal data.

Avoid vague entries such as `revenue: "money made"`. Avoid putting sample customer records or credentials in definitions because the provider receives this text.

## Scope semantics by source or tenant

With the Next.js adapter:

```ts
getSemanticLayer: ({ actor, dataSource }) => {
  if (dataSource === "enterprise") {
    return enterpriseVocabulary(actor.tenantId);
  }
  return standardVocabulary;
},
```

Return approved server-held vocabulary. Do not accept arbitrary semantic definitions from request JSON.

## Follow-up questions

`useDashu({ keepHistory: true })` stores up to six `{ question, sql }` turns in memory and submits them with later questions.

Important consequences:

1. A turn is added only when an answered result contains `query.sql`.
2. Core returns `query` only when instance policy enables `exposeSql` and the actor has `dashu:view-sql`.
3. Therefore, built-in follow-up history does not work when SQL disclosure is disabled.
4. History lives in component memory. A refresh clears it.
5. Prior SQL is sent to the AI provider as planning context.

If SQL is sensitive, keep history disabled:

```ts
const dashu = useDashu({ keepHistory: false });
```

Do not invent or reconstruct missing SQL in the client.

## Persisting answers

Dashu stores nothing. The Next.js adapter's `onAnswer` hook can persist metadata after a successful result:

```ts
onAnswer: async ({ actor, question, result }) => {
  if (!result.answered || !result.query) return;

  await savedQueries.create({
    ownerId: actor.id,
    tenantId: actor.tenantId,
    question,
    sql: result.query.sql,
    dialect: result.query.dialect,
    display: result.display.primary,
    createdAt: new Date(),
  });
},
```

`savedQueries` is your persistence service, not a Dashu export.

Treat stored SQL as sensitive data: it reveals schema names, joins, and business logic. Encrypt or restrict it according to your threat model.

## Replaying stored SQL safely

Use `dashu.run` on the server:

```ts
const saved = await savedQueries.requireForActor(queryId, actor.id, actor.tenantId);

const result = await dashu.run({
  sql: saved.sql,
  actor,
  dataSource: saved.dataSource,
  display: saved.display,
  policy: policyForCurrentRequest(actor),
});
```

Safety properties:

- `dashu:ask` is checked again;
- current policy is resolved again;
- SQL is validated again;
- current row and timeout limits apply;
- PostgreSQL still executes inside a read-only transaction;
- no model call is made.

A query being valid when saved does not authorize it forever. Re-check record ownership, tenant, source access, and current product permissions before loading it.

## Exporting CSV

`toCsv(result.data)` only formats rows already present in the browser. Check `result.capabilities.export` before showing an export action for correct product behavior, but understand that the flag cannot prevent a user who already received data from serializing it.

If you implement a server-side export endpoint, authorize it independently and apply its own row/size controls. Do not assume a previous ask response grants future export access.

## Versioning stored data

Store at least:

- the Dashu result contract version (`"1"` currently);
- SQL dialect;
- data-source identifier;
- display specification;
- tenant/owner identifiers;
- timestamps and, if useful, the original question.

On replay, reject unsupported contract/dialect versions and never let a stored source identifier bypass current source authorization.
