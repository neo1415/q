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
  /**
   * The provider ACCOUNT cannot serve anything until a person acts (credit
   * or quota exhausted, billing limit hit). Not retried on the same model,
   * and the provider is skipped for a while rather than retried per turn.
   */
  readonly accountExhausted?: boolean | undefined;
  readonly cause?: unknown;
};

export class ModelProviderFailure extends Error {
  readonly failureClass: ModelFailureClass;
  readonly providerCode: ModelProviderCode;
  readonly providerStatus: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly vendorErrorCode: string | undefined;
  readonly accountExhausted: boolean;

  constructor(message: string, options: ModelProviderFailureOptions) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "ModelProviderFailure";
    this.failureClass = options.failureClass;
    this.providerCode = options.providerCode;
    this.providerStatus = options.providerStatus;
    this.retryAfterMs = options.retryAfterMs;
    this.vendorErrorCode = options.vendorErrorCode;
    this.accountExhausted = options.accountExhausted === true;
  }
}

export type ModelGatewayErrorOptions = {
  readonly failureClass: ModelFailureClass;
  readonly attempts: number;
  readonly candidates: readonly ModelCandidateDecision[];
  readonly routingPolicyCode?: string | undefined;
  readonly cause?: unknown;
  /** INVALID_MODEL_OUTPUT: the refused fields (paths and codes, never values). */
  readonly refusals?: readonly string[] | undefined;
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
  readonly refusals: readonly string[] | undefined;

  constructor(message: string, options: ModelGatewayErrorOptions) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "ModelGatewayError";
    this.failureClass = options.failureClass;
    this.attempts = options.attempts;
    this.candidates = options.candidates;
    this.routingPolicyCode = options.routingPolicyCode;
    this.refusals = options.refusals;
  }
}

export function isModelGatewayError(
  error: unknown,
): error is ModelGatewayError {
  return error instanceof ModelGatewayError;
}

/** Provider-side reasons a planned model was not available to ask. */
const PROVIDER_UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  "PROVIDER_TEMPORARILY_FAILING",
  "PROVIDER_UNCONFIGURED",
  "PROVIDER_DISABLED",
]);

/**
 * Whether a failure means Q's reasoning service could not be reached at
 * all -- every route set aside (an exhausted account, a refused key, an
 * outage), none configured, or the spend limit -- as opposed to a model
 * that was asked and gave nothing usable in time (a timeout, a refused
 * answer). The person is told the first plainly, and that what they said
 * is kept; it is never their message's fault (live 2026-10-31: OpenAI
 * credit ran out and turns were answered "send it again").
 */
export function isModelServiceUnavailable(error: unknown): boolean {
  if (!isModelGatewayError(error)) return false;
  switch (error.failureClass) {
    case "BUDGET_EXCEEDED":
    case "AUTHENTICATION":
    case "PROVIDER_OUTAGE":
      return true;
    case "PERMANENT":
      return (
        error.cause instanceof ModelProviderFailure &&
        error.cause.accountExhausted
      );
    case "POLICY_INELIGIBLE":
      // Only when providers, not the request's own privacy or price, left
      // it without a route.
      return (
        error.candidates.some(
          (decision) => decision.reason === "PROVIDER_TEMPORARILY_FAILING",
        ) ||
        (error.candidates.length > 0 &&
          error.candidates.every((decision) =>
            PROVIDER_UNAVAILABLE_REASONS.has(decision.reason),
          ))
      );
    // Asked and answered nothing usable, or stopped: not unreachable.
    case "TRANSIENT":
    case "RATE_LIMIT":
    case "TIMEOUT":
    case "INVALID_MODEL_OUTPUT":
    case "INVALID_REQUEST":
    case "CONTEXT_LIMIT":
    case "CANCELLED":
      return false;
  }
}
