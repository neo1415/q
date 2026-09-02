import { z } from "zod";

import { CorrelationIdSchema, RequestIdSchema } from "../common/ids.js";
import { ValidationIssueSchema } from "../common/validation.js";
import { ErrorCodeSchema, KnownErrorCodeSchema } from "./error-codes.js";

/**
 * RFC 9457 Problem Details, as Capital Q produces and consumes them.
 *
 * The media type is application/problem+json. Capital Q adds three extension
 * members the RFC permits: `code`, `requestId` and `correlationId`, plus
 * `errors` for validation failures.
 *
 * There is deliberately no metadata, debug, context or extras bag. An
 * open-ended object on an error response is how stack traces, SQL and provider
 * payloads eventually reach clients. Every extension is a named, typed field.
 */
const problemBase = {
  /**
   * Identifies the class of problem, not the occurrence. Clients branch on
   * `code`; `type` is a stable documentation identifier.
   */
  type: z.string().min(1),

  /** Short, stable, safe summary of the problem class. Never occurrence detail. */
  title: z.string().min(1),

  /**
   * Must equal the actual HTTP response status. A problem body claiming 403
   * inside an HTTP 200 breaks every client that trusts either one.
   */
  status: z
    .number()
    .int()
    .min(400, "a problem status is a 4xx or 5xx code")
    .max(599, "a problem status is a 4xx or 5xx code"),

  /** Occurrence-specific and safe for this caller. Omitted when nothing safe can be said. */
  detail: z.string().optional(),

  /** Optional occurrence identifier. Omitted rather than filled with a misleading value. */
  instance: z.string().optional(),

  /** Present only on validation failures; not an empty array on unrelated problems. */
  errors: z.array(ValidationIssueSchema).optional(),
};

/**
 * What a Capital Q server emits.
 *
 * Stricter than the RFC requires: `code` and `requestId` are mandatory, because
 * a Capital Q failure a client cannot branch on or trace is not useful.
 */
export const ProblemDetailsSchema = z.object({
  ...problemBase,
  code: KnownErrorCodeSchema,
  requestId: RequestIdSchema,
  correlationId: CorrelationIdSchema.optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * What a Capital Q client accepts.
 *
 * Same shape, looser on values that may legitimately evolve server-side: an
 * unrecognised-but-well-formed code, or a correlation identifier format this
 * client predates. Structure is still enforced -- a malformed body is rejected.
 */
export const ConsumerProblemDetailsSchema = z.object({
  ...problemBase,
  code: ErrorCodeSchema,
  requestId: z.string().min(1).max(128),
  correlationId: z.string().min(1).max(128).optional(),
});

export type ConsumerProblemDetails = z.infer<
  typeof ConsumerProblemDetailsSchema
>;

/** The media type every Capital Q problem response uses. */
export const PROBLEM_CONTENT_TYPE = "application/problem+json" as const;
