import { DashuAiProvider } from '@rophpad/dashu-core';

type ManagedOptions = {
    /** Root of the Dashu Cloud deployment, e.g. https://dashu.dev */
    cloudUrl: string;
    /** Revocable credential issued to this installation. Backend only. */
    credential: string;
    /**
     * Managed routing picks the model, so this is a capability name rather than
     * a vendor model id.
     */
    model?: string;
    timeoutMs?: number;
};
/**
 * Dashu Managed AI.
 *
 * The request path is product backend → Dashu Cloud → model provider, and back.
 * Cloud owns entitlement, quotas, rate limiting and the provider credentials;
 * this package owns none of them, which is why it is this thin.
 *
 * What crosses the boundary is the planning prompt: the question, the filtered
 * schema and approved vocabulary. Database credentials, result rows and host
 * session cookies never reach it — SQL execution stays in the host backend.
 */
declare function managedProvider(options: ManagedOptions): DashuAiProvider;

export { type ManagedOptions, managedProvider };
