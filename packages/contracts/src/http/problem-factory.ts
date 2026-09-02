import { ContractValidationError } from "../common/validation.js";
import type { ValidationIssue } from "../common/validation.js";
import type { KnownErrorCode } from "./error-codes.js";
import type { ProblemDetails } from "./problem-details.js";

/**
 * Problem type identifiers.
 *
 * A URN rather than an https URL: the architecture's illustrative
 * `api.capitalq.example` host is the reserved documentation TLD, and baking any
 * hostname in would tie a stable contract identifier to a deployment detail
 * that differs per environment and would 404 in every one of them. A URN is
 * stable, environment-independent, and still a valid RFC 9457 type.
 */
const PROBLEM_TYPE_PREFIX = "urn:capitalq:problem" as const;

type ProblemDefinition = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
};

const define = (
  slug: string,
  title: string,
  status: number,
): ProblemDefinition => ({
  type: `${PROBLEM_TYPE_PREFIX}:${slug}`,
  title,
  status,
});

/**
 * The single mapping from error code to wire type, title and default status.
 *
 * Centralised so route handlers never invent their own titles or pick their own
 * statuses, which is how two endpoints end up describing the same failure
 * differently.
 *
 * Titles describe the class of problem only. Occurrence detail belongs in
 * `detail`, and only when it is safe for the caller to read.
 */
export const PROBLEM_DEFINITIONS: Readonly<
  Record<KnownErrorCode, ProblemDefinition>
> = {
  VALIDATION_FAILED: define(
    "validation-failed",
    "The request is not valid.",
    422,
  ),
  AUTHENTICATION_REQUIRED: define(
    "authentication-required",
    "Authentication is required.",
    401,
  ),
  PERMISSION_DENIED: define(
    "permission-denied",
    "You do not have permission to perform this action.",
    403,
  ),
  RESOURCE_NOT_FOUND: define(
    "resource-not-found",
    "The requested resource was not found.",
    404,
  ),
  RESOURCE_CONFLICT: define(
    "resource-conflict",
    "The request conflicts with the current state of the resource.",
    409,
  ),
  VERSION_CONFLICT: define(
    "version-conflict",
    "The resource has changed since it was read.",
    409,
  ),
  IDEMPOTENCY_CONFLICT: define(
    "idempotency-conflict",
    "This idempotency key was already used with a different request.",
    409,
  ),
  RATE_LIMITED: define("rate-limited", "Too many requests.", 429),
  Q_APPROVAL_REQUIRED: define(
    "q-approval-required",
    "This action requires human approval before it can be executed.",
    409,
  ),
  Q_ACTION_EXPIRED: define(
    "q-action-expired",
    "The prepared action is no longer available.",
    410,
  ),
  PROVIDER_UNAVAILABLE: define(
    "provider-unavailable",
    "A required provider is temporarily unavailable.",
    503,
  ),
  UPLOAD_NOT_READY: define(
    "upload-not-ready",
    "The upload is not ready yet.",
    409,
  ),
  INVALID_REQUEST: define(
    "invalid-request",
    "The request could not be understood.",
    400,
  ),
  INTERNAL_SERVER_ERROR: define(
    "internal-server-error",
    "Something went wrong.",
    500,
  ),
};

export type CreateProblemInput = {
  readonly code: KnownErrorCode;
  readonly requestId: string;
  readonly correlationId?: string | undefined;
  /** Only text that is safe for this caller to read. */
  readonly detail?: string | undefined;
  readonly instance?: string | undefined;
  readonly errors?: readonly ValidationIssue[] | undefined;
  /**
   * Overrides the definition's default. Some codes are legitimately expressed
   * at more than one status depending on the operation -- a version conflict
   * can be 409 or 412.
   */
  readonly status?: number | undefined;
};

/**
 * Build a Problem Details body.
 *
 * Optional members are omitted rather than emitted as null or an empty array,
 * so `errors` appears only on validation problems and its presence is itself
 * meaningful.
 */
export function createProblemDetails(
  input: CreateProblemInput,
): ProblemDetails {
  const definition = PROBLEM_DEFINITIONS[input.code];

  const problem: ProblemDetails = {
    type: definition.type,
    title: definition.title,
    status: input.status ?? definition.status,
    code: input.code,
    requestId: input.requestId,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.instance === undefined ? {} : { instance: input.instance }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
    ...(input.errors === undefined ? {} : { errors: [...input.errors] }),
  };

  return problem;
}

export type ProblemContext = {
  readonly requestId: string;
  readonly correlationId?: string | undefined;
};

/**
 * Map an arbitrary thrown value to a safe Problem Details body.
 *
 * This is the redaction boundary, and it is deliberately conservative: only
 * error types Capital Q defines produce a specific response. Everything else --
 * a provider exception, a driver error, a bug -- becomes a generic 500 with no
 * detail.
 *
 * The thrown value's own message, stack, cause and any `statusCode` it carries
 * are never read. An arbitrary object must not be able to choose the public
 * status of a response or write its own text into it; that is how SQL,
 * connection strings and provider payloads reach clients. Diagnostics belong in
 * the server's structured logs.
 *
 * Framework-neutral by design: no HTTP framework is imported here, so the same
 * decision logic serves every Capital Q HTTP surface.
 */
export function problemFromUnknownError(
  error: unknown,
  context: ProblemContext,
): ProblemDetails {
  if (error instanceof ContractValidationError) {
    return createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId: context.requestId,
      correlationId: context.correlationId,
      errors: error.issues,
    });
  }

  return createProblemDetails({
    code: "INTERNAL_SERVER_ERROR",
    requestId: context.requestId,
    correlationId: context.correlationId,
  });
}
