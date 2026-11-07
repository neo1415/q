import { z } from "zod";

/**
 * ONBOARDING-LONG-ANSWER: the eval of onboarding P1-1 (DECISIONS 77, 72).
 * Q judges when to summarise a long answer: a clear one (typed or spoken,
 * any length) is kept in the person's own words with only filler removed;
 * a rambling one is summarised professionally and said back for their yes.
 * The reader (ONBOARDING_TRANSCRIPT_READER v14) decides by meaning; code
 * checks a "their words" claim by structure (cleanedFromTheirLine).
 *
 * Every case is fictional. At least 30% is held out (heldout.ts) and is
 * never tuned against. Curveballs both ways: a long but clear typed answer,
 * a rambling spoken one, a short ramble, a clear spoken one with light
 * filler, lists, one line covering two steps, a correction mid-answer,
 * non-native English, and answers with figures.
 */
export const LONG_ANSWER_DATASET_VERSION = "onboarding-long-answer-v1" as const;

export const LONG_ANSWER_CATEGORIES = [
  "LONG_CLEAR_TYPED",
  "RAMBLING_SPOKEN",
  "SHORT_RAMBLE",
  "CLEAR_SPOKEN_FILLER",
  "LIST",
  /** One line answers two LONG_TEXT steps: a summary for each (v14). */
  "TWO_STEPS",
  "CORRECTION",
  "NON_NATIVE",
  "FIGURES",
  "SHORT_CLEAR",
] as const;
export type LongAnswerCategory = (typeof LONG_ANSWER_CATEGORIES)[number];

export const LONG_ANSWER_DECISIONS = ["KEEP", "SUMMARISE"] as const;
export type LongAnswerDecision = (typeof LONG_ANSWER_DECISIONS)[number];

const StepKeySchema = z.string().regex(/^[FI]\d+\.[a-z_]+$/u);

export const LongAnswerCaseSchema = z
  .object({
    id: z.string().min(1),
    split: z.enum(["dev", "heldout"]),
    side: z.enum(["FOUNDER", "INVESTOR"]),
    category: z.enum(LONG_ANSWER_CATEGORIES),
    mode: z.enum(["TYPED", "SPOKEN"]),
    /** Q's line before their answer. */
    asked: z.string().min(1),
    /** The person's whole line (fictional). */
    said: z.string().min(1),
    /** The LONG_TEXT steps the reading is shown, with their questions. */
    steps: z
      .array(z.object({ stepKey: StepKeySchema, question: z.string().min(1) }))
      .min(1),
    /** What a correct reading does for each step their line answers. */
    expect: z
      .array(
        z.object({
          stepKey: StepKeySchema,
          decision: z.enum(LONG_ANSWER_DECISIONS),
          /** SUMMARISE: figures and names from the line it must keep. */
          mustKeep: z.array(z.string().min(1)).default([]),
        }),
      )
      .min(1),
    /**
     * The scripted (recorded/expected) reading for the offline mode: what
     * a correct v14 reading gives. Graded exactly like a live one.
     */
    scripted: z
      .array(
        z.object({
          stepKey: StepKeySchema,
          value: z.string().min(1),
          ownWords: z.boolean(),
        }),
      )
      .min(1),
  })
  .strict();
export type LongAnswerCase = z.infer<typeof LongAnswerCaseSchema>;
export type LongAnswerCaseInput = z.input<typeof LongAnswerCaseSchema>;

/** One step's value as a reading gave it (scripted or live). */
export type LongAnswerReading = readonly {
  readonly stepKey: string;
  readonly value: string;
  readonly ownWords: boolean;
}[];
