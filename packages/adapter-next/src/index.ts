import {
  DashuError,
  errorStatus,
  toErrorResponse,
  type Dashu,
  type DashuActor,
  type DashuPolicyInput,
  type AskTurn,
  type SemanticLayer,
} from "@rophpad/dashu-core";

/**
 * Everything trusted is produced by these callbacks, on the server, from the
 * host's own session. The request body contributes exactly one thing: the
 * question. That asymmetry is the entire point of the adapter.
 */
export type DashuRouteOptions = {
  /**
   * Resolve the authenticated administrator. Return `null` to refuse — the
   * route answers 403 without telling the caller why.
   */
  getActor: (request: Request) => Promise<DashuActor | null> | DashuActor | null;
  /** Choose the approved data source, usually from the actor's tenant. */
  selectDataSource?: (context: {
    actor: DashuActor;
    request: Request;
  }) => Promise<string | undefined> | string | undefined;
  /** Narrow the instance policy for this actor. It can restrict, never widen. */
  getPolicy?: (context: {
    actor: DashuActor;
    request: Request;
  }) => Promise<DashuPolicyInput | undefined> | DashuPolicyInput | undefined;
  /** Approved business vocabulary for this actor's data source. */
  getSemanticLayer?: (context: {
    actor: DashuActor;
    dataSource?: string;
  }) => Promise<SemanticLayer | undefined> | SemanticLayer | undefined;
  /**
   * Called after a successful answer, so the host can persist what it wants to.
   * The SDK stores nothing: history and dashboards belong to the host product.
   */
  onAnswer?: (context: {
    actor: DashuActor;
    question: string;
    result: Awaited<ReturnType<Dashu["ask"]>>;
  }) => Promise<void> | void;
};

type AskBody = {
  question?: unknown;
  history?: unknown;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Only the shape is trusted here; the model sees this, so it stays bounded. */
function parseHistory(value: unknown): AskTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is AskTurn =>
        typeof turn === "object" &&
        turn !== null &&
        typeof (turn as AskTurn).question === "string" &&
        typeof (turn as AskTurn).sql === "string",
    )
    .slice(-6);
}

async function resolveActor(
  request: Request,
  options: DashuRouteOptions,
): Promise<DashuActor> {
  const actor = await options.getActor(request);
  if (!actor) {
    throw new DashuError("FORBIDDEN", "Administrator access is required.");
  }
  return actor;
}

function fail(error: unknown): Response {
  const requestId = error instanceof DashuError && error.requestId ? error.requestId : "req_unknown";

  // The detail is the half that must not travel. Logging it here is what makes
  // the redacted response acceptable to operate.
  if (error instanceof DashuError) {
    if (error.detail) console.error(`[dashu] ${requestId} ${error.code}: ${error.detail}`);
  } else {
    console.error(`[dashu] ${requestId} unhandled`, error);
  }

  return json(toErrorResponse(error, requestId), errorStatus(error));
}

/**
 * POST handler for questions.
 *
 * ```ts
 * export const POST = dashuRoute(dashu, {
 *   getActor: async (request) => {
 *     const user = await requireCurrentUser(request);
 *     return user.permissions.includes("dashu:ask")
 *       ? { id: user.id, tenantId: user.tenantId, permissions: user.permissions }
 *       : null;
 *   },
 * });
 * ```
 */
export function dashuRoute(dashu: Dashu, options: DashuRouteOptions) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const actor = await resolveActor(request, options);

      let body: AskBody;
      try {
        body = (await request.json()) as AskBody;
      } catch {
        throw new DashuError("INVALID_REQUEST", "Invalid JSON body.");
      }

      const question = typeof body.question === "string" ? body.question : "";
      const dataSource = await options.selectDataSource?.({ actor, request });

      const result = await dashu.ask({
        question,
        actor,
        dataSource,
        policy: await options.getPolicy?.({ actor, request }),
        semantic: await options.getSemanticLayer?.({ actor, dataSource }),
        history: parseHistory(body.history),
        // Propagates a browser disconnect through to the provider and the
        // database, so an abandoned question stops costing money.
        signal: request.signal,
      });

      await options.onAnswer?.({ actor, question, result });

      return json(result, 200);
    } catch (error) {
      return fail(error);
    }
  };
}

/**
 * POST handler for replaying stored SQL — the fast path behind dashboards.
 * No model call, and the SQL is re-validated under the *current* policy.
 */
export function dashuRunRoute(dashu: Dashu, options: DashuRouteOptions) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const actor = await resolveActor(request, options);

      let body: { sql?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        throw new DashuError("INVALID_REQUEST", "Invalid JSON body.");
      }

      const dataSource = await options.selectDataSource?.({ actor, request });

      const result = await dashu.run({
        sql: typeof body.sql === "string" ? body.sql : "",
        actor,
        dataSource,
        policy: await options.getPolicy?.({ actor, request }),
        signal: request.signal,
      });

      return json(result, 200);
    } catch (error) {
      return fail(error);
    }
  };
}

/** GET handler for the approved schema, for a schema browser. */
export function dashuSchemaRoute(dashu: Dashu, options: DashuRouteOptions) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const actor = await resolveActor(request, options);
      const dataSource = await options.selectDataSource?.({ actor, request });

      const schema = await dashu.schema({
        actor,
        dataSource,
        policy: await options.getPolicy?.({ actor, request }),
        force: new URL(request.url).searchParams.get("refresh") === "1",
      });

      return json({ version: "1", schema }, 200);
    } catch (error) {
      return fail(error);
    }
  };
}
