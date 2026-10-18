import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * The error-monitoring hook (audit F-D7). Every failed Q turn, job or model
 * call goes through one structured line with its failure class, so an
 * operator can count and alert on classes in whatever holds the logs
 * (today Railway's log stream; tomorrow an OTLP backend), and a person's
 * "it just stopped" maps to a class rather than to a guess.
 *
 * The classes are the recovery's QFailureClass set
 * (`packages/contracts/src/q/turn.ts`), repeated here as plain strings so
 * this package stays dependency-free; a test pins the two lists together.
 *
 * Nothing about content is accepted: ids, a class, a code and an error
 * (which the logger's redaction and serializers already strip).
 */

export const FAILURE_CLASSES = [
  "SPEECH_RECOGNITION",
  "MODEL_REASONING",
  "PERMISSION_DENIED",
  "TOOL_UNAVAILABLE",
  "TOOL_FAILED",
  "UI_TARGET_MISSING",
  "NOT_CONFIRMED",
  "RESULT_DELIVERY",
  "SPEECH_PLAYBACK",
  "AGENT_BLOCKED",
  "NETWORK",
  "TIMEOUT",
  "BUDGET",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export type FailureRecord = {
  readonly failureClass: FailureClass;
  /** Where it failed: a bounded name such as "q.turn", "worker.outbox". */
  readonly where: string;
  /** A stable machine code, e.g. a provider's failure class. */
  readonly code?: string | undefined;
  readonly turnId?: string | undefined;
  readonly runId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly correlationId?: string | undefined;
  /** An outside vendor's HTTP status, when it answered. */
  readonly vendorStatus?: number | undefined;
  readonly err?: unknown;
};

export type FailureSink = (record: FailureRecord) => void;

let sink: FailureSink | undefined;

/**
 * Registers the one extra destination for failure records (an error
 * tracker, a counter). Returns the previous sink so a test can restore it.
 * A sink that throws is ignored: monitoring must never fail the caller.
 */
export function setFailureSink(
  next: FailureSink | undefined,
): FailureSink | undefined {
  const previous = sink;
  sink = next;
  return previous;
}

/** Any logger with a structured `error`: pino's, or a runner's narrower one. */
export type FailureLogger = {
  readonly error: (fields: Record<string, unknown>, message: string) => void;
};

export function logQFailure(
  logger: FailureLogger,
  record: FailureRecord,
): void {
  const { err, failureClass, ...ids } = record;
  logger.error(
    {
      ...ids,
      qFailureClass: failureClass,
      ...(err === undefined ? {} : { err }),
    },
    `failure: ${failureClass}`,
  );
  // Marks the active span failed, so a trace exported over OTLP shows
  // where the turn broke. A no-op until an SDK is registered.
  const span = trace.getActiveSpan();
  if (span !== undefined) {
    span.setAttribute("q.failure_class", failureClass);
    span.setStatus({ code: SpanStatusCode.ERROR, message: failureClass });
  }
  try {
    sink?.(record);
  } catch {
    // Deliberately swallowed: see setFailureSink.
  }
}
