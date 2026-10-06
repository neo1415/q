import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Small readers of people's words (founder brief J7, 2026-10-06): what
 * fixed phrase lists used to guess -- a skip, a "why", a yes; whether a
 * named sector is wanted or ruled out; what a call led to; one closed
 * question about a sentence -- read by meaning, in any wording and any
 * language, through the Model Gateway's cheap FAST_CLASSIFICATION class.
 * Each returns one closed shape; code decides what it may do, and a
 * reading that fails falls back to the safe default of its caller.
 *
 *   ONBOARDING_MOVE_READER   a conversational move in reply to one setup
 *                            question (skip, don't know, why, upload, yes,
 *                            no), or none.
 *   PREFERENCE_POLARITY      for each named term in a mandate or a
 *                            preference, whether the text wants it, rules
 *                            it out, would rather avoid it, or neither.
 *   MEETING_OUTCOME_READER   what a call's agreed lines say it led to.
 *   UTTERANCE_CHECK          one closed yes/no question about a sentence.
 */

// ---------------------------------------------------------------------------
// ONBOARDING_MOVE_READER
// ---------------------------------------------------------------------------

export const ONBOARDING_MOVE_READER_SCHEMA_NAME = "OnboardingMoveReaderResult";
export const ONBOARDING_MOVE_READER_SCHEMA_VERSION = 1;

export const ONBOARDING_MOVES = [
  "SKIP",
  "DONT_KNOW",
  "WHY",
  "UPLOAD",
  "YES",
  "NO",
  "NONE",
] as const;
export type OnboardingMove = (typeof ONBOARDING_MOVES)[number];

export const OnboardingMoveReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The setup question, in Capital Q's words. Trusted. */
    question: z.string().trim().min(1).max(600),
    /** Its answer options, one per line, or "none". Trusted. */
    options: z.string().max(2_000),
    /** What they said. UNTRUSTED. */
    utterance: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type OnboardingMoveReaderVariables = z.infer<
  typeof OnboardingMoveReaderVariablesSchema
>;
export const ONBOARDING_MOVE_READER_UNTRUSTED = ["utterance"] as const;

export const OnboardingMoveReaderResultSchema = z
  .object({ move: z.enum(ONBOARDING_MOVES) })
  .strict();
export type OnboardingMoveReaderResult = z.infer<
  typeof OnboardingMoveReaderResultSchema
>;

// ---------------------------------------------------------------------------
// PREFERENCE_POLARITY
// ---------------------------------------------------------------------------

export const PREFERENCE_POLARITY_SCHEMA_NAME = "PreferencePolarityResult";
export const PREFERENCE_POLARITY_SCHEMA_VERSION = 1;

export const POLARITIES = ["WANTED", "EXCLUDED", "AVOIDED", "NEUTRAL"] as const;
export type Polarity = (typeof POLARITIES)[number];

export const PreferencePolarityVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /**
     * One mention per line: "<id> | <term> | <the sentence it is in>".
     * UNTRUSTED (the sentences are the person's own words).
     */
    mentions: z.string().trim().min(1).max(12_000),
  })
  .strict();
export type PreferencePolarityVariables = z.infer<
  typeof PreferencePolarityVariablesSchema
>;
export const PREFERENCE_POLARITY_UNTRUSTED = ["mentions"] as const;

export const PreferencePolarityResultSchema = z
  .object({
    mentions: z
      .array(
        z
          .object({
            id: z.string().max(40),
            polarity: z.enum(POLARITIES),
          })
          .strict(),
      )
      .max(80),
  })
  .strict();
export type PreferencePolarityResult = z.infer<
  typeof PreferencePolarityResultSchema
>;

// ---------------------------------------------------------------------------
// MEETING_OUTCOME_READER
// ---------------------------------------------------------------------------

export const MEETING_OUTCOME_READER_SCHEMA_NAME = "MeetingOutcomeReaderResult";
export const MEETING_OUTCOME_READER_SCHEMA_VERSION = 1;

export const MEETING_OUTCOMES_READ = [
  "DILIGENCE",
  "FOLLOW_UP_MEETING",
  "MATERIALS_REQUESTED",
  "INTRODUCTIONS",
  "NONE",
] as const;

export const MeetingOutcomeReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The call's agreed lines and follow-ups, one per line. UNTRUSTED. */
    lines: z.string().trim().min(1).max(6_000),
  })
  .strict();
export type MeetingOutcomeReaderVariables = z.infer<
  typeof MeetingOutcomeReaderVariablesSchema
>;
export const MEETING_OUTCOME_READER_UNTRUSTED = ["lines"] as const;

export const MeetingOutcomeReaderResultSchema = z
  .object({ outcome: z.enum(MEETING_OUTCOMES_READ) })
  .strict();
export type MeetingOutcomeReaderResult = z.infer<
  typeof MeetingOutcomeReaderResultSchema
>;

// ---------------------------------------------------------------------------
// UTTERANCE_CHECK
// ---------------------------------------------------------------------------

export const UTTERANCE_CHECK_SCHEMA_NAME = "UtteranceCheckResult";
export const UTTERANCE_CHECK_SCHEMA_VERSION = 1;

export const UtteranceCheckVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** One closed question about the words, in Capital Q's words. Trusted. */
    question: z.string().trim().min(1).max(600),
    /** The words. UNTRUSTED. */
    utterance: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type UtteranceCheckVariables = z.infer<
  typeof UtteranceCheckVariablesSchema
>;
export const UTTERANCE_CHECK_UNTRUSTED = ["utterance"] as const;

export const UtteranceCheckResultSchema = z
  .object({ answer: z.enum(["YES", "NO", "UNSURE"]) })
  .strict();
export type UtteranceCheckResult = z.infer<typeof UtteranceCheckResultSchema>;
