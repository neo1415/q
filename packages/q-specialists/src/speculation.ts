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

/**
 * What the speculative answer is asked to be (TURN_READER v78 answerKind):
 * a lookup, the commonest plain question. Adopted only when the reading
 * says the same, so the answer runs at the task class and reasoning the
 * reading would have given it.
 */
export const SPECULATIVE_ANSWER_KIND = "LOOKUP";

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
  /**
   * The words were bound to records (the reader's references, or code's
   * own pointing): the turn's answer carries that binding, which the
   * speculative answer, started before it, does not.
   */
  | "BOUND"
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
  /** The turn's words were bound to records for its answer this run. */
  readonly bound?: boolean | undefined;
}): QSpeculationCancelReason | null {
  const { final, speculative } = input;
  if (final.turnUnread === true) return "UNREAD";
  if (final.turnKind !== speculative.turnKind) return "KIND";
  // Reader latency (2026-11-06): the turn's answer is given the binding
  // (withReferences) after the speculation began without it. Never adopt
  // an answer that was not told what "it", "her" or "the second one" is.
  if (
    input.bound === true ||
    final.references !== undefined ||
    final.referencedCompanyIds !== undefined
  ) {
    return "BOUND";
  }
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
    // The real reading may require a lookup the speculative subject lacked.
    (final.aboutNamedOther === true) !==
      (speculative.aboutNamedOther === true) ||
    // A fit question is answered from the computed fit, by code.
    final.fitQuestion !== undefined ||
    final.discoverCompanies !== undefined ||
    JSON.stringify(final.capabilities) !==
      JSON.stringify(speculative.capabilities) ||
    READING_FIELDS.some(
      (field) =>
        JSON.stringify(normalised(final[field])) !==
        JSON.stringify(normalised(speculative[field])),
    )
  ) {
    return "NOTE";
  }
  return null;
}

/**
 * What the reading puts on the answer's request beyond its kind (steps 3-4,
 * TURN_READER v77-v78, and the K-lanes): each changes the answer's task
 * class, reasoning, route or prompt, so the speculation's answer is the
 * turn's only when every one is the same. Listed rather than inferred, and
 * compared whole: a field added to the reading must be added here.
 * `questionKind` is compared above, as the voice lane decided (ADVICE and
 * THEIR_OWN_RECORDS only).
 */
const READING_FIELDS = [
  "answerKind",
  "askParts",
  "rememberAsk",
  "asksForChart",
  "asksForWeb",
  "preparedSubject",
  "namedOther",
] as const satisfies readonly (keyof QAnswerRequest)[];

/** Absent, null and false say the same: nothing was read. */
function normalised(value: unknown): unknown {
  return value === undefined || value === null || value === false
    ? null
    : value;
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
    readonly teamJob?: boolean | undefined;
    readonly meetingPrep?: unknown;
    readonly appAction?: unknown;
    readonly askedAction?: string | null | undefined;
    /** Their own work board (reader boardAsk): answered by its own branch. */
    readonly boardAsk?: string | null | undefined;
    /** v78: the work the turn asks of the answer, and a compound ask's parts. */
    readonly answerKind?: string | null | undefined;
    readonly parts?: readonly unknown[] | undefined;
    /** v77: the phrases bound to the conversation's records. */
    readonly references?: readonly unknown[] | undefined;
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
    // QA QO-32 (2026-10-23): a call to prepare ("Prep me for a call with
    // Zino") or a team job is answered by its own branch; left running,
    // the speculative analyst answer was spoken first ("I'll play Zino
    // Aviation" over an older list) and the prep landed after the next
    // turn. Cancelled the moment the reading says so.
    read.teamJob === true ||
    (read.meetingPrep ?? null) !== null ||
    (read.appAction ?? null) !== null ||
    (read.askedAction ?? null) !== null ||
    // F-76: "what's on my board?" spoken got the approvals list from the
    // speculative answer; the board branch answers it.
    (read.boardAsk ?? null) !== null ||
    (read.reference?.open ?? null) !== null ||
    read.reference?.retryLast === true
  ) {
    return "ACTED";
  }
  // Known as soon as the reading lands, rather than at the end of the path.
  if ((read.references?.length ?? 0) > 0) return "BOUND";
  if (
    (read.answerKind ?? null) !== SPECULATIVE_ANSWER_KIND ||
    (read.parts?.length ?? 0) >= 2
  ) {
    return "NOTE";
  }
  return null;
}
