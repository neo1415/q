import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * INTERVIEW_CONDUCTOR — Q conducting the onboarding interview
 * (CQ-Q-VOICE-001 rework: Q leads, the person talks).
 *
 * Inputs are the interview's state as Capital Q's own records hold it: what
 * is already answered, every step still open with its real options and
 * constraints, what Q last asked, anything Q read back and is waiting to
 * have confirmed, and the recent turns. The person's words are DATA.
 *
 * Output is what Q says next plus structured readings of what the person
 * just said — proposals that deterministic code validates, confirms and
 * records; nothing becomes a record because the model wrote it.
 */

export const INTERVIEW_CONDUCTOR_SCHEMA_NAME = "InterviewConductorResult";
export const INTERVIEW_CONDUCTOR_SCHEMA_VERSION = 1;

const StepKey = z.string().min(1).max(64);

export const InterviewOpenStepSchema = z
  .object({
    stepKey: StepKey,
    question: z.string().max(400),
    /** What the answer must be. */
    kind: z.enum([
      "ONE_OF",
      "MANY_OF",
      "NUMBER",
      "SHORT_TEXT",
      "LONG_TEXT",
      "YES_NO",
      "CATEGORIES",
      "DOCUMENT",
    ]),
    required: z.boolean(),
    /** For ONE_OF / MANY_OF: the real choices. Answer with `key`. */
    options: z
      .array(
        z.object({
          key: z.string().max(64),
          label: z.string().max(120),
          description: z.string().max(300).optional(),
        }),
      )
      .max(50)
      .optional(),
    maxChoices: z.number().int().min(1).max(50).optional(),
    /** For NUMBER: the unit and bounds. Answer with a plain number in this unit. */
    unit: z.string().max(16).optional(),
    min: z.string().max(40).optional(),
    max: z.string().max(40).optional(),
    /** Trusted note from the definition, e.g. why Q asks. */
    note: z.string().max(400).optional(),
  })
  .strict();
export type InterviewOpenStep = z.infer<typeof InterviewOpenStepSchema>;

export const InterviewConductorVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    journey: z.enum(["founder", "investor"]),
    /** "voice" turns are spoken aloud; "text" turns are read. */
    channel: z.enum(["voice", "text"]),
    /** True for the very first line of a session: greet and ask, nothing was said yet. */
    opening: z.boolean(),
    knownAnswers: z
      .array(
        z.object({
          stepKey: StepKey,
          question: z.string().max(400),
          value: z.string().max(400),
        }),
      )
      .max(80),
    openSteps: z.array(InterviewOpenStepSchema).max(60),
    /** The step the interview is at; ask this next unless the person leads elsewhere. */
    currentStepKey: StepKey.nullable(),
    /** Values Q read back last time and is waiting to have confirmed. */
    pendingConfirmations: z
      .array(
        z.object({
          stepKey: StepKey,
          question: z.string().max(400),
          value: z.string().max(400),
        }),
      )
      .max(8),
    /** Things the runtime could not record last turn, so Q can ask again plainly. */
    notes: z.array(z.string().max(300)).max(6),
    recentTurns: z
      .array(
        z.object({
          role: z.enum(["person", "q"]),
          text: z.string().max(1_500),
        }),
      )
      .max(16),
    utterance: z.string().max(2_000),
  })
  .strict();
export type InterviewConductorVariables = z.infer<
  typeof InterviewConductorVariablesSchema
>;

export const INTERVIEW_CONDUCTOR_UNTRUSTED = [
  "recentTurns",
  "utterance",
] as const;

const AnswerValueSchema = z.union([
  z.string().max(2_000),
  z.array(z.string().max(120)).max(50),
  z.boolean(),
]);

export const InterviewConductorResultSchema = z
  .object({
    /** Exactly what Q says next. Conversational, first person, one or two sentences plus the next question. */
    reply: z.string().min(1).max(700),
    intent: z.enum([
      "ANSWER",
      "QUESTION_FOR_Q",
      "CORRECTION",
      "PAUSE",
      "RESUME",
      "THINKING",
      "SMALL_TALK",
      "UNCLEAR",
      "OPENING",
    ]),
    /** Every step the person's words answered, as the step's own kind of value. */
    answers: z
      .array(
        z.object({
          stepKey: StepKey,
          value: AnswerValueSchema,
          confidence: z.enum(["HIGH", "MEDIUM"]),
        }),
      )
      .max(12),
    /** For CATEGORIES steps: plain phrases describing what was said; the platform maps them. */
    categoryPhrases: z
      .array(
        z.object({
          stepKey: StepKey,
          phrases: z.array(z.string().max(80)).min(1).max(8),
        }),
      )
      .max(4),
    /** Decisions on values Q read back earlier. */
    confirmations: z
      .array(
        z.object({
          stepKey: StepKey,
          decision: z.enum(["CONFIRMED", "REJECTED", "REVISED"]),
          value: AnswerValueSchema.optional(),
        }),
      )
      .max(8),
    /** Optional steps the person set aside ("I don't know", "not now"). */
    skips: z.array(StepKey).max(6),
    /** The step Q is asking in `reply`, when it is asking one. */
    askNext: StepKey.nullable(),
    /** Whether the person should see the options for `askNext` on screen. */
    showOptions: z.boolean(),
    /** When intent is QUESTION_FOR_Q: the question, in the person's words. */
    questionForQ: z.string().max(1_000).nullable(),
  })
  .strict();
export type InterviewConductorResult = z.infer<
  typeof InterviewConductorResultSchema
>;
