import {
  ConsumerProblemDetailsSchema,
  isKnownErrorCode,
  PROBLEM_CONTENT_TYPE,
  type ConsumerProblemDetails,
  type KnownErrorCode,
} from "@capital-q/contracts";

/**
 * Client-internal code for a response that is not a Capital Q problem at all --
 * an HTML error page from a proxy, a truncated body, a gateway timeout.
 *
 * Deliberately distinct from the server vocabulary so application code can tell
 * "Capital Q rejected this" from "something between us and Capital Q broke".
 * It is never sent by a server and must never be treated as one.
 */
export const UNEXPECTED_API_RESPONSE = "UNEXPECTED_API_RESPONSE" as const;

/**
 * Validate an unknown value as a Capital Q problem body.
 *
 * Returns undefined rather than throwing, because a malformed error body is an
 * ordinary condition on a network boundary, not an exceptional one.
 *
 * Tolerant of a well-formed code this client does not recognise: the API
 * evolves additively, and an older client must keep working against a newer
 * server. Structure is still enforced.
 */
export function parseProblemDetails(
  input: unknown,
): ConsumerProblemDetails | undefined {
  const result = ConsumerProblemDetailsSchema.safeParse(input);
  return result.success ? result.data : undefined;
}

/**
 * A failed Capital Q API call.
 *
 * Carries the parsed problem when the server returned one, and enough to act on
 * without it otherwise. The raw response body is deliberately not retained: it
 * may be an upstream error page containing infrastructure detail, and anything
 * kept here tends to end up in a log or an error tracker.
 */
export class ApiProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly problem: ConsumerProblemDetails | undefined;

  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string,
    problem?: ConsumerProblemDetails,
  ) {
    super(message);
    this.name = "ApiProblemError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.problem = problem;
  }

  /** True when the code is one this client build knows how to handle specially. */
  get isKnownCode(): boolean {
    return isKnownErrorCode(this.code);
  }

  /** Narrowed code, or undefined when the server is newer than this client. */
  get knownCode(): KnownErrorCode | undefined {
    return isKnownErrorCode(this.code) ? this.code : undefined;
  }

  /** Field-level issues, present only on validation failures. */
  get validationIssues(): ConsumerProblemDetails["errors"] {
    return this.problem?.errors;
  }
}

function looksLikeProblemResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  // Allow standards-compliant parameters such as "; charset=utf-8".
  return contentType.split(";")[0]?.trim() === PROBLEM_CONTENT_TYPE;
}

/**
 * Turn a failed fetch Response into an ApiProblemError.
 *
 * Always produces a usable error. A response that is not a valid Capital Q
 * problem falls back to the client-internal code rather than surfacing whatever
 * the body happened to contain.
 */
export async function readProblemResponse(
  response: Response,
): Promise<ApiProblemError> {
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;

  if (!looksLikeProblemResponse(response)) {
    return new ApiProblemError(
      "The API returned an unexpected response.",
      response.status,
      UNEXPECTED_API_RESPONSE,
      headerRequestId,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Invalid JSON. The body is not inspected further and is not retained.
    return new ApiProblemError(
      "The API returned an unreadable response.",
      response.status,
      UNEXPECTED_API_RESPONSE,
      headerRequestId,
    );
  }

  const problem = parseProblemDetails(body);

  if (problem === undefined) {
    return new ApiProblemError(
      "The API returned an unexpected response.",
      response.status,
      UNEXPECTED_API_RESPONSE,
      headerRequestId,
    );
  }

  return new ApiProblemError(
    problem.title,
    problem.status,
    problem.code,
    problem.requestId,
    problem,
  );
}
