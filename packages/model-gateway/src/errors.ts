import type {
  ModelCandidateDecision,
  ModelFailureClass,
  ModelProviderCode,
} from "@capital-q/contracts";

/**
 * Failures, normalized (doc 12 §48; doc 22 §141; packet §35).
 *
 * Two errors exist. A provider adapter throws ModelProviderFailure with a
 * stable class and a SAFE message of its own wording; the vendor's
 * exception travels only as `cause`, for private diagnostics, and is never
 * interpolated into anything that leaves the process. The gateway throws
 * ModelGatewayError when it has exhausted what policy allows; user-facing
 * code maps its class to a public Q failure code and nothing else.
 */

export type ModelProviderFailureOptions = {
  readonly failureClass: ModelFailureClass;
  readonly providerCode: ModelProviderCode;
  /** The vendor's HTTP status, for private observability only. */
  readonly providerStatus?: number | undefined;
  /** When the provider asked us to wait. */
  readonly retryAfterMs?: number | undefined;
  /** The vendor's stable error code token (e.g. `tool_use_failed`), never its message. */
  readonly vendorErrorCode?: string | undefined;
  readonly cause?: unknown;
};

export class ModelProviderFailure extends Error {
  readonly failureClass: ModelFailureClass;
  readonly providerCode: ModelProviderCode;
  readonly providerStatus: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly vendorErrorCode: string | undefined;

  constructor(message: string, options: ModelProviderFailureOptions) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "ModelProviderFailure";
    this.failureClass = options.failureClass;
    this.providerCode = options.providerCode;
    this.providerStatus = options.providerStatus;
    this.retryAfterMs = options.retryAfterMs;
    this.vendorErrorCode = options.vendorErrorCode;
  }
}

export type ModelGatewayErrorOptions = {
  readonly failureClass: ModelFailureClass;
  readonly attempts: number;
  readonly candidates: readonly ModelCandidateDecision[];
  readonly routingPolicyCode?: string | undefined;
  readonly cause?: unknown;
};

/**
 * The gateway could not produce a validated result. Its message is the
 * gateway's own sentence; the last provider failure, if any, is the cause.
 */
export class ModelGatewayError extends Error {
  readonly failureClass: ModelFailureClass;
  readonly attempts: number;
  readonly candidates: readonly ModelCandidateDecision[];
  readonly routingPolicyCode: string | undefined;

  constructor(message: string, options: ModelGatewayErrorOptions) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "ModelGatewayError";
    this.failureClass = options.failureClass;
    this.attempts = options.attempts;
    this.candidates = options.candidates;
    this.routingPolicyCode = options.routingPolicyCode;
  }
}

export function isModelGatewayError(
  error: unknown,
): error is ModelGatewayError {
  return error instanceof ModelGatewayError;
}
