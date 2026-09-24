import { z } from "zod";

import {
  QuestionToQSchema,
  ReadingConfidenceSchema,
  TranscriptQualitySchema,
  TurnKindSchema,
} from "../../conversation/reading.js";
import { TaskFrameSchema } from "./common.js";

/**
 * TURN_READER — what was this turn, in a conversation with Q outside the
 * interview? (CQ-QX-005, ADR 0011)
 *
 * Home, the Q sheet and voice outside onboarding have no job of steps to
 * answer, so the interview conductor's reading does not apply whole. What
 * they share with it is the part that decides behaviour: what kind of
 * turn it was, how sure the reading is, whether the words themselves came
 * through, and — for a question to Q — which kind of question, because
 * that is what the research policy decides on. The model reads meaning
 * into this closed shape; the conversation core decides what it may do.
 */

export const TURN_READER_SCHEMA_NAME = "TurnReaderResult";
export const TURN_READER_SCHEMA_VERSION = 1;

export const TurnReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The last few turns before it, oldest first. UNTRUSTED. */
    recentTurns: z
      .array(
        z.object({
          role: z.enum(["USER", "Q"]),
          text: z.string().max(400),
        }),
      )
      .max(6),
    /** What the person just said or typed. UNTRUSTED. */
    utterance: z.string().trim().min(1).max(2_000),
    /** Whether it arrived by voice (a transcript) or typed. Trusted. */
    modality: z.enum(["VOICE", "TEXT"]),
  })
  .strict();
export type TurnReaderVariables = z.infer<typeof TurnReaderVariablesSchema>;

export const TURN_READER_UNTRUSTED = ["recentTurns", "utterance"] as const;

export const TurnReaderResultSchema = z
  .object({
    kind: TurnKindSchema,
    confidence: ReadingConfidenceSchema,
    transcript: TranscriptQualitySchema,
    /** For QUESTION_TO_Q and RESEARCH_REQUEST: which kind of question. */
    question: QuestionToQSchema.nullable().default(null),
    /**
     * The turn is about a specific company, organisation or person other
     * than the speaker, named in the words ("tell me about Acme"). Capital
     * Q's own records answer it first; the public web only if they hold
     * nothing — which is what makes naming something not a search.
     */
    aboutNamedOther: z.boolean().default(false),
  })
  .strict();
export type TurnReaderResult = z.infer<typeof TurnReaderResultSchema>;
