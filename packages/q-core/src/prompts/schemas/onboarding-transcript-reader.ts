import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * ONBOARDING_TRANSCRIPT_READER (owner 2026-10-27): the whole onboarding
 * conversation, read once by meaning into what the person has said about
 * themselves for each step. Capital Q saves it through the same checked
 * path a typed answer takes; the reading itself writes nothing.
 */
export const ONBOARDING_TRANSCRIPT_READER_SCHEMA_NAME =
  "OnboardingTranscriptReaderResult";
export const ONBOARDING_TRANSCRIPT_READER_SCHEMA_VERSION = 1;

const StepKeySchema = z.string().min(1).max(80);

export const OnboardingTranscriptReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** "investor" or "founder". Trusted. */
    journey: z.enum(["investor", "founder"]),
    /** The setup's steps: what each asks, its kind, options and record. Trusted. */
    steps: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            question: z.string().max(400),
            kind: z.string().max(40),
            required: z.boolean(),
            options: z.string().max(2_000),
            onRecord: z.string().max(600),
          })
          .strict(),
      )
      .max(80),
    /** The conversation, oldest first, one "PERSON:"/"Q:" line each. UNTRUSTED. */
    transcript: z.string().trim().min(1).max(60_000),
  })
  .strict();
export type OnboardingTranscriptReaderVariables = z.infer<
  typeof OnboardingTranscriptReaderVariablesSchema
>;

export const ONBOARDING_TRANSCRIPT_READER_UNTRUSTED = ["transcript"] as const;

const ValueSchema = z.union([
  z.string().min(1).max(2_000),
  z.array(z.string().min(1).max(200)).min(1).max(20),
  z.number(),
  z.boolean(),
]);

export const OnboardingTranscriptReaderResultSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            value: ValueSchema,
            quote: z.string().trim().min(1).max(400),
            ownWords: z.boolean(),
          })
          .strict(),
      )
      .max(60),
    declined: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            quote: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type OnboardingTranscriptReaderResult = z.infer<
  typeof OnboardingTranscriptReaderResultSchema
>;

/**
 * v2 (owner 2026-10-28): each answer says whether, for a list step, it is
 * the whole list (a correction or a replacement, read by meaning) or adds
 * to what is on record. Live, Tiara's "crypto and gambling" exclusions
 * were replaced by "adult content" said later as one more.
 */
export const ONBOARDING_TRANSCRIPT_READER_V2_SCHEMA_VERSION = 2;

export const OnboardingTranscriptReaderV2ResultSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            value: ValueSchema,
            quote: z.string().trim().min(1).max(400),
            ownWords: z.boolean(),
            /**
             * List steps: true when they meant this as the whole list
             * (they corrected or replaced what they said before), false
             * when it adds to it. Other steps: false.
             */
            replaces: z.boolean().default(false),
          })
          .strict(),
      )
      .max(60),
    declined: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            quote: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type OnboardingTranscriptReaderV2Result = z.infer<
  typeof OnboardingTranscriptReaderV2ResultSchema
>;

/**
 * v3 (live recheck 2026-10-30): each answer says whether the person's words
 * are about that step itself. The description they had confirmed was
 * replaced by their answer to the industry question: a step already on
 * record changes only on words about that step (Q asked it, they named it,
 * or they corrected what they said for it); code also checks the question
 * Q's line asked.
 */
export const ONBOARDING_TRANSCRIPT_READER_V3_SCHEMA_VERSION = 3;

export const OnboardingTranscriptReaderV3ResultSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            value: ValueSchema,
            quote: z.string().trim().min(1).max(400),
            ownWords: z.boolean(),
            replaces: z.boolean().default(false),
            /**
             * True only when their words are about this step itself: Q's
             * question just before asked about it, they named what it is
             * about, or they corrected or added to what they said for it.
             * False when the words answer a different question.
             */
            aboutStep: z.boolean().default(false),
          })
          .strict(),
      )
      .max(60),
    declined: z
      .array(
        z
          .object({
            stepKey: StepKeySchema,
            quote: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type OnboardingTranscriptReaderV3Result = z.infer<
  typeof OnboardingTranscriptReaderV3ResultSchema
>;
