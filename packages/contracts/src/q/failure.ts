import { z } from "zod";

import { RequestIdSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { PROVIDER_ERROR_KINDS } from "../providers/errors.js";
import { QRunIdSchema } from "./ids.js";

/**
 * Why a Q run did not complete, in two projections that must never be
 * confused (doc 12 §47; doc 22 §21; CLAUDE.md user-facing language rule).
 *
 *   QRunFailure     INTERNAL. A stable diagnostic code plus private detail.
 *                   Goes to logs, traces and the run record. Never to a
 *                   client.
 *
 *   QPublicFailure  PUBLIC. A stable public code plus a fixed plain-English
 *                   sentence. Goes to clients. Produced only by
 *                   toPublicQFailure, which reads the diagnostic code and
 *                   nothing else.
 *
 * The mapping is a table, not string formatting. No exception message, SQL
 * text, provider payload, stack trace, Zod issue or enum name can reach the
 * public shape, because there is no code path that copies text from one to
 * the other.
 */

/**
 * Stable internal diagnostic vocabulary. Bounded and enumerable so runtime
 * code branches on a code and observability can count them. A vendor's own
 * error belongs in the provider error, not here.
 */
export const Q_FAILURE_DIAGNOSTIC_CODES = [
  "INVALID_REQUEST",
  /** A subject could not be resolved to exactly one canonical entity (TM-Q-11). */
  "SUBJECT_NOT_RESOLVED",
  "CONTEXT_RESOLUTION_FAILED",
  /** The Context Firewall or authorisation refused the request. */
  "POLICY_DENIED",
  "MODEL_PROVIDER_TIMEOUT",
  "MODEL_PROVIDER_UNAVAILABLE",
  "EVIDENCE_PROCESSING_UNAVAILABLE",
  "RETRIEVAL_FAILED",
  "TOOL_FAILED",
  "APPROVAL_EXPIRED",
  /** Token, cost, time or loop budget exhausted (doc 12 §49-51). */
  "BUDGET_EXCEEDED",
  "RUN_CANCELLED",
  "RUN_EXPIRED",
  "INTERNAL_ERROR",
] as const;

export type QFailureDiagnosticCode =
  (typeof Q_FAILURE_DIAGNOSTIC_CODES)[number];

export const QFailureDiagnosticCodeSchema = z.enum(Q_FAILURE_DIAGNOSTIC_CODES);

export const Q_FAILURE_DETAIL_MAX_LENGTH = 2000;

/** INTERNAL. Never serialised to a client. */
export const QRunFailureSchema = z
  .object({
    diagnosticCode: QFailureDiagnosticCodeSchema,
    /**
     * Private diagnostic text for logs and traces. May describe what went
     * wrong in engineering terms. Must still never carry a secret, a
     * credential or private business content -- it is a log line, and log
     * lines travel.
     */
    detail: z.string().max(Q_FAILURE_DETAIL_MAX_LENGTH).optional(),
    /** The provider error taxonomy member, when a provider was involved. */
    providerErrorKind: z.enum(PROVIDER_ERROR_KINDS).optional(),
    occurredAt: UtcTimestampSchema,
  })
  .strict();

export type QRunFailure = z.infer<typeof QRunFailureSchema>;

/**
 * Stable public vocabulary. Deliberately coarser than the diagnostic one.
 *
 * SUBJECT_NOT_RESOLVED, CONTEXT_RESOLUTION_FAILED and POLICY_DENIED all
 * become NOT_AVAILABLE_IN_CONTEXT: a person who is not permitted to see a
 * document must not be able to tell, from the failure, whether it exists.
 */
export const Q_PUBLIC_FAILURE_CODES = [
  "REQUEST_INVALID",
  "NOT_AVAILABLE_IN_CONTEXT",
  "Q_TIMEOUT",
  "Q_UNAVAILABLE",
  "EVIDENCE_UNAVAILABLE",
  "ACTION_EXPIRED",
  "CANCELLED",
  "EXPIRED",
  "Q_FAILED",
] as const;

export type QPublicFailureCode = (typeof Q_PUBLIC_FAILURE_CODES)[number];

export const QPublicFailureCodeSchema = z.enum(Q_PUBLIC_FAILURE_CODES);

/**
 * The only words a person reads for each public code. Short, calm,
 * specific, non-technical; reworded here, never composed at runtime.
 */
export const Q_PUBLIC_FAILURE_MESSAGES: Readonly<
  Record<QPublicFailureCode, string>
> = {
  REQUEST_INVALID:
    "Q couldn't understand that request. Please rephrase it and try again.",
  NOT_AVAILABLE_IN_CONTEXT:
    "I don't have information I can use to answer that in your current access context.",
  Q_TIMEOUT: "Q is taking longer than expected right now. Please try again.",
  Q_UNAVAILABLE: "Q isn't available right now. Please try again shortly.",
  EVIDENCE_UNAVAILABLE:
    "I couldn't review the supporting information right now. Please try again shortly.",
  ACTION_EXPIRED:
    "The prepared action is no longer available. Ask Q to prepare it again if you still need it.",
  CANCELLED: "This request was cancelled.",
  EXPIRED: "This request expired before it could finish. Please try again.",
  Q_FAILED: "Q couldn't complete this request. Please try again.",
};

export const Q_PUBLIC_FAILURE_MESSAGE_MAX_LENGTH = 300;

/** PUBLIC. The failure a client receives. */
export const QPublicFailureSchema = z
  .object({
    code: QPublicFailureCodeSchema,
    message: z.string().min(1).max(Q_PUBLIC_FAILURE_MESSAGE_MAX_LENGTH),
    /** Whether the same request, unchanged, could plausibly succeed later. */
    retryable: z.boolean(),
    runId: QRunIdSchema.optional(),
    /** So support can find the private diagnostic without the client seeing it. */
    requestId: RequestIdSchema.optional(),
  })
  .strict();

export type QPublicFailure = z.infer<typeof QPublicFailureSchema>;

type PublicProjection = {
  readonly code: QPublicFailureCode;
  readonly retryable: boolean;
};

const PUBLIC_PROJECTION: Readonly<
  Record<QFailureDiagnosticCode, PublicProjection>
> = {
  INVALID_REQUEST: { code: "REQUEST_INVALID", retryable: false },
  SUBJECT_NOT_RESOLVED: { code: "NOT_AVAILABLE_IN_CONTEXT", retryable: false },
  CONTEXT_RESOLUTION_FAILED: {
    code: "NOT_AVAILABLE_IN_CONTEXT",
    retryable: false,
  },
  POLICY_DENIED: { code: "NOT_AVAILABLE_IN_CONTEXT", retryable: false },
  MODEL_PROVIDER_TIMEOUT: { code: "Q_TIMEOUT", retryable: true },
  MODEL_PROVIDER_UNAVAILABLE: { code: "Q_UNAVAILABLE", retryable: true },
  EVIDENCE_PROCESSING_UNAVAILABLE: {
    code: "EVIDENCE_UNAVAILABLE",
    retryable: true,
  },
  RETRIEVAL_FAILED: { code: "EVIDENCE_UNAVAILABLE", retryable: true },
  TOOL_FAILED: { code: "Q_FAILED", retryable: true },
  APPROVAL_EXPIRED: { code: "ACTION_EXPIRED", retryable: false },
  BUDGET_EXCEEDED: { code: "Q_FAILED", retryable: false },
  RUN_CANCELLED: { code: "CANCELLED", retryable: false },
  RUN_EXPIRED: { code: "EXPIRED", retryable: true },
  INTERNAL_ERROR: { code: "Q_FAILED", retryable: true },
};

/**
 * Identifiers to attach to the public failure. Plain strings: they are
 * validated against the public schema on the way out, so a caller need not
 * hold a branded value to name a run.
 */
export type QPublicFailureRefs = {
  readonly runId?: string | undefined;
  readonly requestId?: string | undefined;
};

/** The internal failure, or anything that at least names its diagnostic code. */
export type QRunFailureLike = Pick<QRunFailure, "diagnosticCode"> &
  Partial<Omit<QRunFailure, "diagnosticCode">>;

/**
 * The redaction boundary for Q run failures.
 *
 * Reads `diagnosticCode` and only `diagnosticCode`. `detail`,
 * `providerErrorKind` and anything else on the internal failure are not
 * consulted, so nothing written there can be echoed here. The result is
 * validated against the public schema before it is returned, so a future
 * edit that widened the table could not slip an unbounded string through.
 */
export function toPublicQFailure(
  failure: QRunFailureLike,
  refs: QPublicFailureRefs = {},
): QPublicFailure {
  const projection = PUBLIC_PROJECTION[failure.diagnosticCode];

  return QPublicFailureSchema.parse({
    code: projection.code,
    message: Q_PUBLIC_FAILURE_MESSAGES[projection.code],
    retryable: projection.retryable,
    ...(refs.runId === undefined ? {} : { runId: refs.runId }),
    ...(refs.requestId === undefined ? {} : { requestId: refs.requestId }),
  });
}
