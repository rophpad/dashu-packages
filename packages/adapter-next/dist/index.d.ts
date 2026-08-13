import { DashuActor, DashuPolicyInput, SemanticLayer, Dashu } from '@rophpad/dashu-core';

/**
 * Everything trusted is produced by these callbacks, on the server, from the
 * host's own session. The request body contributes exactly one thing: the
 * question. That asymmetry is the entire point of the adapter.
 */
type DashuRouteOptions = {
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
declare function dashuRoute(dashu: Dashu, options: DashuRouteOptions): (request: Request) => Promise<Response>;
/**
 * POST handler for replaying stored SQL — the fast path behind dashboards.
 * No model call, and the SQL is re-validated under the *current* policy.
 */
declare function dashuRunRoute(dashu: Dashu, options: DashuRouteOptions): (request: Request) => Promise<Response>;
/** GET handler for the approved schema, for a schema browser. */
declare function dashuSchemaRoute(dashu: Dashu, options: DashuRouteOptions): (request: Request) => Promise<Response>;

export { type DashuRouteOptions, dashuRoute, dashuRunRoute, dashuSchemaRoute };
