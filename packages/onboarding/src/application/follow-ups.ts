import type {
  OnboardingInterviewQuestionView,
  OnboardingResponseValue,
} from "@capital-q/contracts";

import type { OnboardingStepDefinition } from "../contracts/index.js";

/**
 * Q's follow-up questions after the interview (Q.01: 194 generated, none
 * ever answered, because answering needed a session still ACTIVE).
 *
 * A follow-up is answered through the same commit as any interview answer
 * (answerInterviewQuestion: validation, the step's write targets, the
 * Write Gate), never by writing a fact directly. These helpers only turn
 * a person's quick pick or typed words into a response the step already
 * accepts; anything they cannot place is refused, never guessed.
 */

export type FollowUpQuickAnswer = {
  readonly label: string;
  readonly stepKey: string;
  readonly value: OnboardingResponseValue;
};

export type FollowUpTyped = "NUMBER" | "TEXT" | "NONE";

export type OnboardingFollowUp = {
  readonly sessionId: string;
  readonly question: OnboardingInterviewQuestionView;
  readonly quickAnswers: readonly FollowUpQuickAnswer[];
  readonly typed: FollowUpTyped;
  /** False: the session completed and this step is not revisable (ADR 0024). */
  readonly answerable: boolean;
};

export type FollowUpAnswer =
  | { readonly kind: "QUICK"; readonly index: number }
  | { readonly kind: "TYPED"; readonly text: string };

const MAX_QUICK = 20;

/** The question's own options first, then the step's choices. */
export function followUpQuickAnswers(
  question: OnboardingInterviewQuestionView,
  step: OnboardingStepDefinition | undefined,
): readonly FollowUpQuickAnswer[] {
  const own: FollowUpQuickAnswer[] = question.options.map((option) => ({
    label: option.label,
    stepKey: option.stepKey,
    value: option.value,
  }));
  if (own.length > 0 || step === undefined) return own.slice(0, MAX_QUICK);
  const configuration = step.configuration;
  if (configuration.stepType === "single_select") {
    return configuration.options.slice(0, MAX_QUICK).map((option) => ({
      label: option.label,
      stepKey: step.stepKey,
      value: { type: "SINGLE_SELECT", optionKey: option.optionKey },
    }));
  }
  return [];
}

export function followUpTyped(
  step: OnboardingStepDefinition | undefined,
): FollowUpTyped {
  switch (step?.configuration.stepType) {
    case "range":
      return "NUMBER";
    case "short_text":
    case "long_text":
    case "voice_text":
      return "TEXT";
    // Choices are answered from the quick answers; files, confirmations
    // and references are not something a typed answer can place.
    case "single_select":
    case "multi_select":
    case "document_upload":
    case "confirmation":
    case "reference_select":
    case undefined:
      return "NONE";
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** The step response for an answer, or null when it cannot be placed. */
export function followUpResponse(
  followUp: Pick<OnboardingFollowUp, "quickAnswers" | "typed" | "question">,
  answer: FollowUpAnswer,
): {
  readonly stepKey: string;
  readonly value: OnboardingResponseValue;
} | null {
  if (answer.kind === "QUICK") {
    const picked = followUp.quickAnswers[answer.index];
    return picked === undefined
      ? null
      : { stepKey: picked.stepKey, value: picked.value };
  }
  const text = answer.text.trim();
  if (text.length === 0) return null;
  if (followUp.typed === "NUMBER") {
    // "1,200" and "1 200" are 1200; anything else is not a figure.
    const figure = text.replace(/[\s,]/g, "");
    return DECIMAL.test(figure)
      ? {
          stepKey: followUp.question.stepKey,
          value: { type: "RANGE", value: figure },
        }
      : null;
  }
  if (followUp.typed === "TEXT") {
    return {
      stepKey: followUp.question.stepKey,
      value: { type: "TEXT", text },
    };
  }
  // A choice typed in words: only an exact label (any case) is taken.
  const lower = text.toLowerCase();
  const match = followUp.quickAnswers.find(
    (quick) => quick.label.toLowerCase() === lower,
  );
  return match === undefined
    ? null
    : { stepKey: match.stepKey, value: match.value };
}
