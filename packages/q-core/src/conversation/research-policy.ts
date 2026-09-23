import { isExhausted, type FailureLedger } from "./failures.js";
import type { ConversationTurnReading } from "./reading.js";
import type { ConversationState } from "./state.js";

/**
 * When Q may go to the public web (CQ-QX-005 §11, §12, §13).
 *
 * Research is intentional. It runs when the person explicitly asks for a
 * real-world or current example, when the question is about public facts,
 * or when the consumer says authorised context was not enough and public
 * research is appropriate — and at no other time. Never on a turn where
 * the person is answering an onboarding question; never halfway through
 * a question already answered; never because a subject's name happened
 * to be recorded (that was the Zino Aviation search). Never twice while
 * one run is in flight, and never at all once research has shown itself
 * to be down, because a run that cannot start is not worth a person's
 * wait.
 *
 * "Based on what you know about me" is THEIR_OWN_RECORDS: authorised
 * context first, and a public source only if the consumer says the
 * context was insufficient — and then said out loud as a change of
 * source, never silently.
 */

export type ResearchDecision =
  | {
      readonly run: true;
      readonly question: string;
      /** Where the conversation returns once the result is in. */
      readonly resumeTopic: string | null;
      /** True when Q must say it is leaving authorised context for the web. */
      readonly announceSourceChange: boolean;
    }
  | {
      readonly run: false;
      readonly because:
        | "NOT_ASKED"
        | "ANSWER_TURN"
        | "ALREADY_RUNNING"
        | "EXHAUSTED"
        | "UNAVAILABLE"
        | "CONTEXT_SUFFICIENT";
    };

export function decideResearch(
  state: ConversationState,
  reading: ConversationTurnReading,
  environment: {
    /** Whether a research route exists at all in this deployment. */
    readonly available: boolean;
    /** For THEIR_OWN_RECORDS: whether authorised context could answer. */
    readonly contextSufficient?: boolean | undefined;
  },
): ResearchDecision {
  const resumeTopic = state.asked?.topic ?? state.topic;
  if (
    reading.kind === "ANSWER" ||
    reading.kind === "CORRECTION" ||
    reading.kind === "CLARIFICATION"
  ) {
    return { run: false, because: "ANSWER_TURN" };
  }
  const question = reading.question;
  const explicit =
    reading.kind === "RESEARCH_REQUEST" ||
    (reading.kind === "QUESTION_TO_Q" &&
      question !== null &&
      (question.kind === "REAL_WORLD_EXAMPLE" ||
        question.kind === "PUBLIC_FACTS"));
  const fromTheirRecords =
    reading.kind === "QUESTION_TO_Q" &&
    question !== null &&
    question.kind === "THEIR_OWN_RECORDS";
  if (!explicit && !fromTheirRecords) {
    return { run: false, because: "NOT_ASKED" };
  }
  if (fromTheirRecords && environment.contextSufficient !== false) {
    return { run: false, because: "CONTEXT_SUFFICIENT" };
  }
  if (!environment.available) {
    return { run: false, because: "UNAVAILABLE" };
  }
  if (isExhausted(state.failures, "RESEARCH")) {
    return { run: false, because: "EXHAUSTED" };
  }
  if (state.research !== null) {
    return { run: false, because: "ALREADY_RUNNING" };
  }
  return {
    run: true,
    question: question?.text ?? "",
    resumeTopic,
    announceSourceChange: fromTheirRecords,
  };
}

/** Whether a failure ledger says research should be described as down. */
export function researchIsDown(ledger: FailureLedger): boolean {
  return isExhausted(ledger, "RESEARCH");
}
