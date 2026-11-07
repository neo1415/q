import type { LongAnswerCaseInput, LongAnswerCategory } from "./contracts.js";

/** The LONG_TEXT steps the cases use, with the question Q asks for each. */
export const LONG_ANSWER_QUESTIONS: Readonly<Record<string, string>> = {
  "F1.description": "What does the company do, in a sentence or two?",
  "F9.problem": "What problem are you solving, and for whom?",
  "F9.solution": "What is your solution?",
  "F9.business_model": "How do you make money?",
  "F9.go_to_market": "How do you reach and sell to customers?",
  "F9.competition": "Who else is solving this, and how are you different?",
  "F9.why_us_why_now": "Why you, and why now?",
  "F9.opportunity": "How big is the opportunity?",
  "F9.vision": "Where do you want the company to be in ten years?",
  "I6.custom_criteria": "In your own words, what do you look for in a company?",
  "I8.portfolio": "Tell me about your portfolio.",
  "I11.additional_context":
    "Anything else founders should know about how you invest?",
};

type Head = {
  readonly id: string;
  readonly split: "dev" | "heldout";
  readonly side: "FOUNDER" | "INVESTOR";
  readonly category: LongAnswerCategory;
  readonly mode: "TYPED" | "SPOKEN";
};

const question = (stepKey: string): string => {
  const q = LONG_ANSWER_QUESTIONS[stepKey];
  if (q === undefined) throw new Error(`no question for ${stepKey}`);
  return q;
};

/** A clear answer: kept as `kept` (their words minus filler; default whole). */
export function keep(
  head: Head,
  stepKey: string,
  said: string,
  kept: string = said,
): LongAnswerCaseInput {
  return {
    ...head,
    asked: question(stepKey),
    said,
    steps: [{ stepKey, question: question(stepKey) }],
    expect: [{ stepKey, decision: "KEEP" }],
    scripted: [{ stepKey, value: kept, ownWords: true }],
  };
}

/** A rambling answer: summarised as `summary`, keeping `mustKeep`. */
export function summarise(
  head: Head,
  stepKey: string,
  said: string,
  summary: string,
  mustKeep: readonly string[] = [],
): LongAnswerCaseInput {
  return {
    ...head,
    asked: question(stepKey),
    said,
    steps: [{ stepKey, question: question(stepKey) }],
    expect: [{ stepKey, decision: "SUMMARISE", mustKeep: [...mustKeep] }],
    scripted: [{ stepKey, value: summary, ownWords: false }],
  };
}

/** One line answering two steps: a summary for each (reader v14). */
export function twoSteps(
  head: Head,
  asked: string,
  said: string,
  parts: readonly {
    readonly stepKey: string;
    readonly summary: string;
    readonly mustKeep?: readonly string[];
  }[],
): LongAnswerCaseInput {
  return {
    ...head,
    asked,
    said,
    steps: parts.map((p) => ({
      stepKey: p.stepKey,
      question: question(p.stepKey),
    })),
    expect: parts.map((p) => ({
      stepKey: p.stepKey,
      decision: "SUMMARISE" as const,
      mustKeep: [...(p.mustKeep ?? [])],
    })),
    scripted: parts.map((p) => ({
      stepKey: p.stepKey,
      value: p.summary,
      ownWords: false,
    })),
  };
}
