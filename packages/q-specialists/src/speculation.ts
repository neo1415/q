import type { TurnReaderResult } from "@capital-q/q-core";
import {
  QSpeculationCancelledError,
  type QAnswerOutcome,
  type QAnswerRequest,
  type QResearchDirective,
} from "@capital-q/q-runtime";

import { RESEARCH_TOOLS } from "./tool-focus.js";

/**
 * Voice speculation (latency2, lead decision 2026-10-06).
 *
 * A spoken turn's answer waits on the turn reader (1.3-2.1 s) because the
 * reading decides the tools offered, whether research is allowed and some
 * of the answer's notes. Most spoken turns are a plain question to Q, so
 * the answer starts at once under a conservative default reading and the
 * reader runs beside it. When the reading comes back the turn takes the
 * path it always took; only where that path arrives at exactly the answer
 * the speculation is already writing is the speculation adopted. Anywhere
 * else it is cancelled before anything of it leaves: the answer seam holds
 * its sentences, stores nothing and runs only READ_ONLY tools until it is
 * adopted (see the model gateway's speculation gate).
 */

/** The conservative default: a general question to Q, nothing else. */
export const SPECULATIVE_READING: TurnReaderResult = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
};

export type QSpeculationCancelReason =
  /** The turn could not be read. */
  | "UNREAD"
  /** Read as something other than a question to Q. */
  | "KIND"
  /** The reading allows or asks for research the default did not. */
  | "RESEARCH"
  /** A named tool, the research tools or a widened offer. */
  | "FOCUS"
  /** A note the default lacks: a lead, a document, a series, an action. */
  | "NOTE"
  /** The turn went another way: a decision, a hand, an action, silence. */
  | "ACTED";

export type QSpeculationEvent = {
  readonly runId: string;
  readonly outcome: "ADOPTED" | "CANCELLED";
  readonly reason: QSpeculationCancelReason | null;
  /** From the speculation's start to its adoption or cancellation. */
  readonly decidedAfterMs: number;
};

export type Speculation = {
  /** The request the speculative answer was started with. */
  readonly request: QAnswerRequest;
  /** Take it as the turn's answer: its held sentences go out now. */
  readonly adopt: () => Promise<QAnswerOutcome>;
  /** Drop it, unsaid and unstored. A no-op once decided. */
  readonly cancel: (reason: QSpeculationCancelReason) => void;
};

export function startSpeculation(input: {
  readonly request: QAnswerRequest;
  readonly answer: (request: QAnswerRequest) => Promise<QAnswerOutcome>;
  readonly observe: (event: QSpeculationEvent) => void;
  readonly now?: (() => number) | undefined;
}): Speculation {
  const now = input.now ?? (() => performance.now());
  const startedAt = now();
  const stop = new AbortController();
  let decide: (adopted: boolean) => void = () => undefined;
  const decided = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  const request: QAnswerRequest = {
    ...input.request,
    // Cancelling stops the model call; the person interrupting still does.
    signal:
      input.request.signal === undefined
        ? stop.signal
        : AbortSignal.any([input.request.signal, stop.signal]),
    speculation: { decided },
  };
  const outcome: Promise<QAnswerOutcome | null> = input
    .answer(request)
    .catch((error: unknown) => {
      if (error instanceof QSpeculationCancelledError) return null;
      throw error;
    });
  // Never an unhandled rejection: adopt() awaits the same promise.
  outcome.catch(() => undefined);
  let state: "PENDING" | "ADOPTED" | "CANCELLED" = "PENDING";
  const settle = (
    to: "ADOPTED" | "CANCELLED",
    reason: QSpeculationCancelReason | null,
  ) => {
    state = to;
    decide(to === "ADOPTED");
    input.observe({
      runId: request.runId,
      outcome: to,
      reason,
      decidedAfterMs: Math.round(now() - startedAt),
    });
  };
  return {
    request,
    adopt: async () => {
      if (state === "PENDING") settle("ADOPTED", null);
      const result = await outcome;
      // Only a cancelled speculation resolves to null, and an adopted one
      // was never cancelled.
      return result ?? { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
    },
    cancel: (reason) => {
      if (state !== "PENDING") return;
      settle("CANCELLED", reason);
      stop.abort();
    },
  };
}

/**
 * Whether the answer the turn's own path arrived at is the one the
 * speculation is writing. Null: adopt it. A reason: cancel it.
 *
 * The tool focus is compared by what it adds: a focus by area only keeps
 * the same tools within reach as the speculation's standard offer, while a
 * named tool, the research tools or a widened offer is a different answer.
 * Offering is never authority either way: every call is authorised.
 */
export function speculationMisfit(input: {
  readonly final: QAnswerRequest;
  readonly finalResearch: QResearchDirective;
  readonly ownRecords: boolean;
  readonly speculative: QAnswerRequest;
  readonly speculativeResearch: QResearchDirective;
}): QSpeculationCancelReason | null {
  const { final, speculative } = input;
  if (final.turnUnread === true) return "UNREAD";
  if (final.turnKind !== speculative.turnKind) return "KIND";
  if (
    JSON.stringify(input.finalResearch) !==
    JSON.stringify(input.speculativeResearch)
  ) {
    return "RESEARCH";
  }
  const focus = final.toolFocus;
  // The public-web tools are in every question's offer, the speculation's
  // included (web search 2026-10-06); only another tool, or a widened offer
  // other than the one the speculation started with, is a different answer.
  const otherTools =
    focus?.tools.filter((tool) => !RESEARCH_TOOLS.includes(tool)) ?? [];
  if (
    focus !== undefined &&
    (otherTools.length > 0 ||
      (focus.widen === true &&
        JSON.stringify(focus) !== JSON.stringify(speculative.toolFocus)))
  ) {
    return "FOCUS";
  }
  if (
    input.ownRecords ||
    final.leadLines !== undefined ||
    final.askedAction !== undefined ||
    final.writingDocument === true ||
    final.questionSequence !== undefined ||
    final.questionKind === "ADVICE" ||
    final.questionKind === "THEIR_OWN_RECORDS" ||
    // A fit question is answered from the computed fit, by code.
    final.fitQuestion !== undefined ||
    JSON.stringify(final.capabilities) !==
      JSON.stringify(speculative.capabilities)
  ) {
    return "NOTE";
  }
  return null;
}

/** A reading that cannot end in the speculation's answer, known at once. */
export function readingMisfit(
  read: {
    readonly kind: string;
    readonly addressedToQ?: boolean | undefined;
    readonly earlierNotForQ?: boolean | undefined;
    readonly saveToOwnProfile?: boolean | undefined;
    readonly tool?: unknown;
    readonly handOver?: unknown;
    readonly appAction?: unknown;
    readonly askedAction?: string | null | undefined;
    readonly reference?:
      | { readonly open: unknown; readonly retryLast: boolean }
      | null
      | undefined;
  } | null,
): QSpeculationCancelReason | null {
  if (read === null) return "UNREAD";
  if (read.kind !== SPECULATIVE_READING.kind) return "KIND";
  if (
    read.addressedToQ === false ||
    read.earlierNotForQ === true ||
    read.saveToOwnProfile === true ||
    (read.tool ?? null) !== null ||
    (read.handOver ?? null) !== null ||
    (read.appAction ?? null) !== null ||
    (read.askedAction ?? null) !== null ||
    (read.reference?.open ?? null) !== null ||
    read.reference?.retryLast === true
  ) {
    return "ACTED";
  }
  return null;
}
