import type { FailureLedger } from "./failures.js";
import type { ConversationTurnReading, QuestionKind } from "./reading.js";
import type { RepairStrategy } from "./repair.js";
import type { ResearchDecision } from "./research-policy.js";

/**
 * The turn, inspectable end to end (CQ-QX-005 §8).
 *
 * raw STT → normalised transcript → intent classification → extracted
 * structured answer → persisted state. When a turn goes wrong, the
 * question is always WHERE, and a transcript alone cannot say: a turn
 * read as unclear is indistinguishable in prose from one that never
 * arrived, and a model that answered nothing looks exactly like a runtime
 * that refused everything.
 *
 * Structured and bounded. It carries keys, kinds and counts, and the raw
 * words only as far as a debugger needs them — never a model's hidden
 * reasoning, and never to the person.
 */

export type TurnTrace = {
  readonly raw: string;
  readonly normalised: string;
  readonly transcript: ConversationTurnReading["transcript"];
  readonly classification: {
    readonly kind: ConversationTurnReading["kind"];
    readonly confidence: ConversationTurnReading["confidence"];
    readonly question: QuestionKind | null;
  };
  readonly extracted: {
    readonly targets: readonly string[];
    readonly references: readonly string[];
    readonly qualitative: readonly string[];
    readonly suggestions: readonly string[];
    readonly tensions: number;
  };
  readonly persisted: {
    readonly recorded: readonly string[];
    readonly held: readonly string[];
    readonly skipped: readonly string[];
    readonly refused: readonly string[];
    readonly carried: readonly string[];
  };
  readonly repair: RepairStrategy | null;
  readonly research: ResearchDecision | null;
  readonly failures: FailureLedger;
};

const RAW_LOG_CHARS = 120;

/** The trace as a log line may carry it: words truncated, nothing else lost. */
export function loggableTrace(trace: TurnTrace): TurnTrace {
  return {
    ...trace,
    raw: trace.raw.slice(0, RAW_LOG_CHARS),
    normalised: trace.normalised.slice(0, RAW_LOG_CHARS),
  };
}

/**
 * Where the turn went wrong, if it did, in one word — the thing an
 * operator reads first. TRANSCRIPT and REASONING are kept apart so that
 * one is never reported as the other.
 */
export function traceVerdict(
  trace: TurnTrace,
): "TRANSCRIPT" | "REASONING" | "WRITE" | "RESEARCH" | "OK" {
  if (
    trace.transcript === "FRAGMENT" ||
    trace.classification.kind === "UNCLEAR_TRANSCRIPT"
  ) {
    return "TRANSCRIPT";
  }
  if (
    trace.persisted.refused.length > 0 &&
    trace.persisted.recorded.length === 0
  ) {
    return "WRITE";
  }
  if (
    trace.research !== null &&
    trace.research.run === false &&
    trace.research.because === "EXHAUSTED"
  ) {
    return "RESEARCH";
  }
  if (trace.repair !== null) {
    return "REASONING";
  }
  return "OK";
}
