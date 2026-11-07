import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";

import type {
  LongAnswerCase,
  LongAnswerReading,
} from "../datasets/onboarding-long-answer/contracts.js";
import {
  gradeLongAnswerCase,
  summariseLongAnswer,
  type LongAnswerStepGrade,
  type LongAnswerSummary,
} from "../graders/onboarding-long-answer.js";

/**
 * Runs ONBOARDING-LONG-ANSWER (P1-1) against a subject: the scripted
 * readings (offline, in vitest) or the real reader through the model
 * gateway (the owner's paid run). Null from the subject: the reading
 * failed, and every step of that case is graded as left out.
 */
export type LongAnswerSubject = (
  c: LongAnswerCase,
) => Promise<LongAnswerReading | null>;

export type LongAnswerRun = {
  readonly grades: readonly LongAnswerStepGrade[];
  readonly summary: LongAnswerSummary;
  /** Cases not run because `stop` said so (a spend cap). */
  readonly skipped: readonly string[];
};

/** The recorded/expected readings: what a correct v14 reading gives. */
export const scriptedLongAnswerSubject: LongAnswerSubject = (c) =>
  Promise.resolve(c.scripted);

/**
 * The real ONBOARDING_TRANSCRIPT_READER: shown Q's question and the
 * person's line, with only the case's LONG_TEXT steps, nothing on record.
 */
export function readerLongAnswerSubject(
  reader: OnboardingTranscriptReader,
  attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  },
): LongAnswerSubject {
  return async (c) => {
    const reading = await reader.read({
      journey: c.side === "FOUNDER" ? "founder" : "investor",
      steps: c.steps.map((s) => ({
        stepKey: s.stepKey,
        question: s.question,
        kind: "LONG_TEXT",
        required: false,
        options: "",
        onRecord: "nothing",
      })),
      turns: [
        { role: "Q", text: c.asked },
        { role: "PERSON", text: c.said },
      ],
      attribution,
    });
    if (reading === null) return null;
    return reading.answers.flatMap((a) =>
      typeof a.value === "string"
        ? [
            {
              stepKey: a.stepKey,
              value: a.value,
              ownWords: a.ownWords,
            },
          ]
        : [],
    );
  };
}

export async function runLongAnswer(
  subject: LongAnswerSubject,
  cases: readonly LongAnswerCase[],
  options: { readonly stop?: () => boolean } = {},
): Promise<LongAnswerRun> {
  const grades: LongAnswerStepGrade[] = [];
  const skipped: string[] = [];
  for (const c of cases) {
    if (options.stop?.() === true) {
      skipped.push(c.id);
      continue;
    }
    grades.push(...gradeLongAnswerCase(c, (await subject(c)) ?? []));
  }
  return { grades, summary: summariseLongAnswer(grades), skipped };
}
