import { DashuError, errorStatus, toErrorResponse } from '@rophpad/dashu-core';

// src/index.ts
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function parseHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (turn) => typeof turn === "object" && turn !== null && typeof turn.question === "string" && typeof turn.sql === "string"
  ).slice(-6);
}
async function resolveActor(request, options) {
  const actor = await options.getActor(request);
  if (!actor) {
    throw new DashuError("FORBIDDEN", "Administrator access is required.");
  }
  return actor;
}
function fail(error) {
  const requestId = error instanceof DashuError && error.requestId ? error.requestId : "req_unknown";
  if (error instanceof DashuError) {
    if (error.detail) console.error(`[dashu] ${requestId} ${error.code}: ${error.detail}`);
  } else {
    console.error(`[dashu] ${requestId} unhandled`, error);
  }
  return json(toErrorResponse(error, requestId), errorStatus(error));
}
function dashuRoute(dashu, options) {
  return async function POST(request) {
    try {
      const actor = await resolveActor(request, options);
      let body;
      try {
        body = await request.json();
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
        signal: request.signal
      });
      await options.onAnswer?.({ actor, question, result });
      return json(result, 200);
    } catch (error) {
      return fail(error);
    }
  };
}
function dashuRunRoute(dashu, options) {
  return async function POST(request) {
    try {
      const actor = await resolveActor(request, options);
      let body;
      try {
        body = await request.json();
      } catch {
        throw new DashuError("INVALID_REQUEST", "Invalid JSON body.");
      }
      const dataSource = await options.selectDataSource?.({ actor, request });
      const result = await dashu.run({
        sql: typeof body.sql === "string" ? body.sql : "",
        actor,
        dataSource,
        policy: await options.getPolicy?.({ actor, request }),
        signal: request.signal
      });
      return json(result, 200);
    } catch (error) {
      return fail(error);
    }
  };
}
function dashuSchemaRoute(dashu, options) {
  return async function GET(request) {
    try {
      const actor = await resolveActor(request, options);
      const dataSource = await options.selectDataSource?.({ actor, request });
      const schema = await dashu.schema({
        actor,
        dataSource,
        policy: await options.getPolicy?.({ actor, request }),
        force: new URL(request.url).searchParams.get("refresh") === "1"
      });
      return json({ version: "1", schema }, 200);
    } catch (error) {
      return fail(error);
    }
  };
}

export { dashuRoute, dashuRunRoute, dashuSchemaRoute };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map