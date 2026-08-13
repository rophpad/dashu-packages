import { DashuError } from "./errors";
import { PERMISSIONS, type DashuActor, type DashuPolicy, type DashuPolicyInput, type DatabaseSchema, type SchemaPolicy } from "./types";

/** Applied when neither the call site nor `createDashu` specifies otherwise. */
export const POLICY_DEFAULTS: DashuPolicy = {
  schemas: [],
  denyTables: [],
  denyColumns: [],
  maxRows: 200,
  statementTimeoutMs: 10_000,
  exposeSql: false,
  allowExport: false,
  allowSaveDashboard: false,
};

/** Beyond this the prompt cost and the browser both suffer. */
const MAX_ROWS_CEILING = 10_000;
const MAX_TIMEOUT_MS = 120_000;

function positive(value: unknown, fallback: number, ceiling: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const name = String(entry ?? "").trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * Merge instance defaults with per-request policy.
 *
 * Disclosure flags are intersected rather than overridden: a request may narrow
 * what it exposes, never widen it. Anything a caller could widen from the
 * request body would stop being a policy.
 */
export function resolvePolicy(
  defaults: DashuPolicyInput | undefined,
  request: DashuPolicyInput | undefined,
): DashuPolicy {
  const base = { ...POLICY_DEFAULTS, ...defaults };
  const input = request ?? {};

  return {
    schemas: input.schemas ? names(input.schemas) : names(base.schemas),
    denyTables: [...names(base.denyTables), ...names(input.denyTables)],
    denyColumns: [...names(base.denyColumns), ...names(input.denyColumns)],
    maxRows: positive(input.maxRows ?? base.maxRows, POLICY_DEFAULTS.maxRows, MAX_ROWS_CEILING),
    statementTimeoutMs: positive(
      input.statementTimeoutMs ?? base.statementTimeoutMs,
      POLICY_DEFAULTS.statementTimeoutMs,
      MAX_TIMEOUT_MS,
    ),
    exposeSql: Boolean(base.exposeSql) && input.exposeSql !== false,
    allowExport: Boolean(base.allowExport) && input.allowExport !== false,
    allowSaveDashboard: Boolean(base.allowSaveDashboard) && input.allowSaveDashboard !== false,
  };
}

/**
 * Derive disclosure from what the actor may do, so a host that maps its roles
 * onto the Dashu permissions gets correct capability flags for free.
 */
function hasPermission(actor: DashuActor, permission: string): boolean {
  const alias = permission.startsWith("dashu:")
    ? `askdb:${permission.slice("dashu:".length)}`
    : permission.startsWith("askdb:")
      ? `dashu:${permission.slice("askdb:".length)}`
      : permission;
  return actor.permissions.includes(permission) || actor.permissions.includes(alias);
}

export function policyForActor(actor: DashuActor): DashuPolicyInput {
  return {
    exposeSql: hasPermission(actor, PERMISSIONS.viewSql),
    allowExport: hasPermission(actor, PERMISSIONS.export),
    allowSaveDashboard: hasPermission(actor, PERMISSIONS.saveDashboard),
  };
}

export function requirePermission(actor: DashuActor, permission: string): void {
  if (!hasPermission(actor, permission)) {
    throw new DashuError("FORBIDDEN", "You do not have permission to do that.", {
      detail: `actor ${actor.id} lacks ${permission}`,
    });
  }
}

function matches(patterns: string[], qualified: string): boolean {
  const lower = qualified.toLowerCase();
  return patterns.some((pattern) => pattern.toLowerCase() === lower);
}

/**
 * Strip denied tables and columns from an introspected schema.
 *
 * This runs before the schema is rendered into a prompt, so a denied table is
 * not merely unmentioned in the instructions — the model never learns it
 * exists. That is the difference between a policy and a suggestion.
 *
 * It is not the security boundary. Database grants are; this keeps the model
 * from writing a query that would be rejected anyway, and keeps private column
 * names out of the provider request.
 */
export function applySchemaPolicy(schema: DatabaseSchema, policy: SchemaPolicy): DatabaseSchema {
  if (!policy.denyTables.length && !policy.denyColumns.length) return schema;

  const tables = schema.tables
    .filter((table) => !matches(policy.denyTables, `${table.schema}.${table.name}`))
    .map((table) => ({
      ...table,
      columns: table.columns.filter(
        (column) =>
          !matches(policy.denyColumns, `${table.schema}.${table.name}.${column.name}`) &&
          !matches(policy.denyColumns, `${table.name}.${column.name}`),
      ),
    }))
    .filter((table) => table.columns.length > 0);

  const visible = new Set(tables.map((table) => `${table.schema}.${table.name}`));

  return {
    ...schema,
    tables,
    // A relationship pointing at a hidden table would disclose its name.
    relationships: schema.relationships.filter(
      (link) =>
        visible.has(`${link.fromSchema}.${link.fromTable}`) &&
        visible.has(`${link.toSchema}.${link.toTable}`),
    ),
  };
}
