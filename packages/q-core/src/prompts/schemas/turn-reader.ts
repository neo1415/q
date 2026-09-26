import { z } from "zod";

import { QNavigateDestinationSchema } from "@capital-q/contracts";

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

/**
 * Which of Q's hands a TOOL_REQUEST reaches for, when it is one Capital Q
 * performs itself rather than one the answer composes (CQ-QACT-001; ADR
 * 0011). Live, "please make my company visible to investors" became a
 * second investor deck: the answer's reading had no word for visibility,
 * so the nearest thing it could name — a document for investors — was
 * prepared. And "take me to Discover", typed, was told to go there
 * itself. The reader names the tool; code decides whether and how it
 * runs, through the same capability the screen uses.
 *
 *   NAVIGATE        go to one of the platform's own surfaces, by name
 *   SET_VISIBILITY  show their company to investors on Capital Q, or take
 *                   it back to their organisation only
 *
 * Flat rather than a union so every provider's structured output can hold
 * it; the parameter that does not belong to the kind is null.
 */
export const TURN_TOOL_KINDS = ["NAVIGATE", "SET_VISIBILITY"] as const;
export const TURN_TOOL_VISIBILITIES = [
  "network_visible",
  "organisation_private",
] as const;

export const TurnToolSchema = z
  .object({
    kind: z.enum(TURN_TOOL_KINDS),
    destination: QNavigateDestinationSchema.nullable().default(null),
    visibility: z.enum(TURN_TOOL_VISIBILITIES).nullable().default(null),
  })
  .strict()
  .refine(
    (tool) =>
      tool.kind === "NAVIGATE"
        ? tool.destination !== null && tool.visibility === null
        : tool.visibility !== null && tool.destination === null,
    { message: "a tool carries exactly its own parameter" },
  );
export type TurnTool = z.infer<typeof TurnToolSchema>;

export const TURN_READER_V2_SCHEMA_VERSION = 2;

/** v1's reading plus the tool a TOOL_REQUEST reaches for, if Capital Q has it. */
export const TurnReaderV2ResultSchema = TurnReaderResultSchema.extend({
  tool: TurnToolSchema.nullable().default(null),
}).strict();
export type TurnReaderV2Result = z.infer<typeof TurnReaderV2ResultSchema>;

/**
 * v3 (CQ-QACT-002): a third hand — producing a document now.
 *
 * Live, a founder asked about eight times for a PDF pitch deck on a
 * company from public sources, and each time Q explained what such a deck
 * would contain, because no reading named the request as something Capital
 * Q does rather than something to talk about. PREPARE_DOCUMENT names it:
 * which kind of document, and which company as the person named it — in
 * this turn or, for "just give me the PDF", in the turns before it. Code
 * then researches, composes, renders and files it; the reader decides
 * nothing about how.
 */
export const TURN_TOOL_V3_KINDS = [
  "NAVIGATE",
  "SET_VISIBILITY",
  "PREPARE_DOCUMENT",
] as const;
export const TURN_DOCUMENT_TYPES = ["PITCH_DECK", "INVESTMENT_BRIEF"] as const;

export const TurnToolV3Schema = z
  .object({
    kind: z.enum(TURN_TOOL_V3_KINDS),
    destination: QNavigateDestinationSchema.nullable().default(null),
    visibility: z.enum(TURN_TOOL_VISIBILITIES).nullable().default(null),
    documentType: z.enum(TURN_DOCUMENT_TYPES).nullable().default(null),
    /** The company as the person named it; null when it is plainly their own. */
    subjectName: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .strict()
  .refine(
    (tool) => {
      switch (tool.kind) {
        case "NAVIGATE":
          return (
            tool.destination !== null &&
            tool.visibility === null &&
            tool.documentType === null
          );
        case "SET_VISIBILITY":
          return (
            tool.visibility !== null &&
            tool.destination === null &&
            tool.documentType === null
          );
        case "PREPARE_DOCUMENT":
          return (
            tool.documentType !== null &&
            tool.destination === null &&
            tool.visibility === null
          );
      }
    },
    { message: "a tool carries exactly its own parameters" },
  );
export type TurnToolV3 = z.infer<typeof TurnToolV3Schema>;

export const TURN_READER_V3_SCHEMA_VERSION = 3;

export const TurnReaderV3ResultSchema = TurnReaderResultSchema.extend({
  tool: TurnToolV3Schema.nullable().default(null),
}).strict();
export type TurnReaderV3Result = z.infer<typeof TurnReaderV3ResultSchema>;

/**
 * v5 (gap 3, ACC 2026-09-25): a document about the person's OWN investment
 * mandate. "Give me my mandate as a PDF" was read as a deck or brief about
 * some company and answered "which company?". OWN_MANDATE names it: built
 * from their own authoritative record, never from research.
 */
export const TURN_DOCUMENT_TYPES_V5 = [
  "PITCH_DECK",
  "INVESTMENT_BRIEF",
  "OWN_MANDATE",
] as const;

export const TurnToolV5Schema = z
  .object({
    kind: z.enum(TURN_TOOL_V3_KINDS),
    destination: QNavigateDestinationSchema.nullable().default(null),
    visibility: z.enum(TURN_TOOL_VISIBILITIES).nullable().default(null),
    documentType: z.enum(TURN_DOCUMENT_TYPES_V5).nullable().default(null),
    /** The company as the person named it; null when it is plainly their own, and for OWN_MANDATE. */
    subjectName: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .strict()
  .refine(
    (tool) => {
      switch (tool.kind) {
        case "NAVIGATE":
          return (
            tool.destination !== null &&
            tool.visibility === null &&
            tool.documentType === null
          );
        case "SET_VISIBILITY":
          return (
            tool.visibility !== null &&
            tool.destination === null &&
            tool.documentType === null
          );
        case "PREPARE_DOCUMENT":
          return (
            tool.documentType !== null &&
            tool.destination === null &&
            tool.visibility === null
          );
      }
    },
    { message: "a tool carries exactly its own parameters" },
  );
export type TurnToolV5 = z.infer<typeof TurnToolV5Schema>;

export const TURN_READER_V5_SCHEMA_VERSION = 5;

export const TurnReaderV5ResultSchema = TurnReaderResultSchema.extend({
  tool: TurnToolV5Schema.nullable().default(null),
}).strict();
export type TurnReaderV5Result = z.infer<typeof TurnReaderV5ResultSchema>;
