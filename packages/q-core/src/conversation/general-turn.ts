import type { TurnReaderResult } from "../prompts/schemas/turn-reader.js";
import {
  isExhausted,
  shouldNotify,
  subsystemNotice,
  type FailureOperation,
} from "./failures.js";
import { EMPTY_TURN_READING, type ConversationTurnReading } from "./reading.js";
import { decideResearch } from "./research-policy.js";
import { reduceConversation, type ConversationState } from "./state.js";

/**
 * The conversation core, for every conversation with Q that is not the
 * interview (CQ-QX-005): Home, the Q sheet, voice outside onboarding.
 *
 * Those surfaces have no steps to write, so most of the interview's
 * machinery does not apply. What does is the part the person feels: Q
 * goes to the public web only when they asked for something real, and
 * a failure is named by the subsystem that failed, once, without the
 * same sentence twice running. Pure functions over the same state and
 * policy the interview uses, so the rules cannot drift apart.
 */

/**
 * Whether the answer path may go to the public web for this turn.
 *
 * EXPLICIT: they asked for something real, current or public — research
 * is offered and, if the model does not reach for it, run. ONLY_IF_EMPTY:
 * a question about their own records — Capital Q's authorised context
 * first, and the web only if that came back empty, said out loud as a
 * change of source. NEVER: everything else — advice, a remark, a turn
 * that merely names a company.
 */
export type ResearchDirective = {
  readonly mode: "EXPLICIT" | "ONLY_IF_EMPTY" | "NEVER";
  /** True when Q must say it is leaving authorised context for the web. */
  readonly announceSourceChange: boolean;
  /**
   * The turn is a question to Q and research is up (not unavailable, not
   * exhausted, not already running): when the answer path asked the
   * platform a question the world can also answer (prospective investors)
   * and the platform came back empty or thin, public sources may fill the
   * gap. Never on an answer, a remark or small talk.
   */
  readonly fallback?: boolean | undefined;
};

export const NO_RESEARCH: ResearchDirective = {
  mode: "NEVER",
  announceSourceChange: false,
};

/** A TURN_READER result as the core's full reading, with the rest empty. */
export function readingFromTurnReader(
  result: TurnReaderResult,
): ConversationTurnReading {
  return {
    ...EMPTY_TURN_READING,
    kind: result.kind,
    confidence: result.confidence,
    transcript: result.transcript,
    question: result.question,
  };
}

export function researchDirectiveFor(
  state: ConversationState,
  reading: ConversationTurnReading,
  environment: {
    readonly available: boolean;
    /** The reader's `aboutNamedOther`: a named company or person not theirs. */
    readonly aboutNamedOther?: boolean | undefined;
  },
): ResearchDirective {
  // Asking about somebody else by name is a question for Capital Q's own
  // records first; the public web only if they hold nothing, because a
  // company Capital Q does not hold usually exists in the world.
  if (
    environment.aboutNamedOther === true &&
    reading.kind === "QUESTION_TO_Q" &&
    reading.question?.kind !== "REAL_WORLD_EXAMPLE" &&
    reading.question?.kind !== "PUBLIC_FACTS"
  ) {
    return environment.available && !isExhausted(state.failures, "RESEARCH")
      ? { mode: "ONLY_IF_EMPTY", announceSourceChange: false }
      : NO_RESEARCH;
  }
  const ownRecords =
    reading.kind === "QUESTION_TO_Q" &&
    reading.question?.kind === "THEIR_OWN_RECORDS";
  // For their own records the policy is asked the conditional question —
  // "if authorised context turned out not to be enough, may Q look?" —
  // because only the answer path learns whether it was.
  const decision = decideResearch(state, reading, {
    available: environment.available,
    ...(ownRecords ? { contextSufficient: false } : {}),
  });
  if (!decision.run) {
    const fallback =
      reading.kind === "QUESTION_TO_Q" &&
      environment.available &&
      !isExhausted(state.failures, "RESEARCH") &&
      state.research === null;
    return fallback ? { ...NO_RESEARCH, fallback: true } : NO_RESEARCH;
  }
  return ownRecords
    ? { mode: "ONLY_IF_EMPTY", announceSourceChange: true }
    : { mode: "EXPLICIT", announceSourceChange: false };
}

/**
 * A failed answer, noted against the conversation, and what Q says.
 *
 * The first failure of a subsystem and the one that exhausts it get the
 * core's narrow notice; the ones between and after get none, so the
 * surface falls back to its own short line rather than repeating the
 * same notice every turn.
 */
export function noteAnswerFailure(
  state: ConversationState,
  operation: FailureOperation,
): { readonly state: ConversationState; readonly notice: string | null } {
  const next = reduceConversation(state, { type: "FAILED", operation });
  return {
    state: next,
    notice: shouldNotify(next.failures, operation)
      ? subsystemNotice(operation, isExhausted(next.failures, operation))
      : null,
  };
}
