/**
 * Structured errors that are safe to return over HTTP.
 *
 * The rule this file exists to enforce: whatever went wrong internally, the
 * caller receives a code, a sentence written for a human, and a request id.
 * Connection strings, provider payloads, prompt bodies and stack traces stay on
 * the server — see `toResponse`.
 */

export type DashuErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "AI_NOT_CONFIGURED"
  | "AI_UNAVAILABLE"
  | "DATA_SOURCE_NOT_CONFIGURED"
  | "SCHEMA_UNAVAILABLE"
  | "QUERY_NOT_ALLOWED"
  | "QUERY_TIMEOUT"
  | "QUERY_FAILED"
  | "RESULT_LIMIT_EXCEEDED"
  | "CANCELLED"
  | "INTERNAL";

const STATUS: Record<DashuErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  AI_NOT_CONFIGURED: 409,
  AI_UNAVAILABLE: 502,
  DATA_SOURCE_NOT_CONFIGURED: 409,
  SCHEMA_UNAVAILABLE: 409,
  QUERY_NOT_ALLOWED: 400,
  QUERY_TIMEOUT: 504,
  QUERY_FAILED: 400,
  RESULT_LIMIT_EXCEEDED: 400,
  CANCELLED: 499,
  INTERNAL: 500,
};

export class DashuError extends Error {
  readonly code: DashuErrorCode;
  readonly status: number;
  readonly requestId?: string;
  /**
   * Extra context for the server log only. Never serialised into a response —
   * this is where a driver message or a provider status ends up.
   */
  readonly detail?: string;

  constructor(
    code: DashuErrorCode,
    message: string,
    options: { requestId?: string; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DashuError";
    this.code = code;
    this.status = STATUS[code];
    this.requestId = options.requestId;
    this.detail = options.detail;
  }

  withRequestId(requestId: string): DashuError {
    if (this.requestId) return this;
    return new DashuError(this.code, this.message, {
      requestId,
      detail: this.detail,
      cause: this.cause,
    });
  }
}

export type DashuErrorResponse = {
  error: {
    code: DashuErrorCode;
    message: string;
    requestId?: string;
  };
};

/**
 * The only thing that should ever reach a browser.
 *
 * An unrecognised error becomes a generic INTERNAL rather than leaking its
 * message: an unexpected throw is exactly the case where the text is most
 * likely to contain a connection string or a file path.
 */
export function toErrorResponse(error: unknown, requestId: string): DashuErrorResponse {
  if (error instanceof DashuError) {
    return {
      error: { code: error.code, message: error.message, requestId },
    };
  }

  return {
    error: {
      code: "INTERNAL",
      message: "Something went wrong handling that question.",
      requestId,
    },
  };
}

export function errorStatus(error: unknown): number {
  return error instanceof DashuError ? error.status : 500;
}
