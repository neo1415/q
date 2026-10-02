import { z } from "zod";

import { QNavigateDestinationSchema } from "@capital-q/contracts";

import {
  QuestionToQSchema,
  ReadingConfidenceSchema,
  TranscriptQualitySchema,
  TurnKindSchema,
} from "../../conversation/reading.js";
import { QuestionSequenceReadingSchema } from "../../conversation/question-sequence.js";
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

/**
 * v7 variables: v1's, plus the other actions this run can take (name and
 * what it does), built by code from what is offered. Trusted.
 */
export const TurnReaderV7VariablesSchema = TurnReaderVariablesSchema.extend({
  actions: z
    .array(
      z.object({
        name: z.string().max(80),
        does: z.string().max(240),
      }),
    )
    .max(30)
    .default([]),
}).strict();
export type TurnReaderV7Variables = z.infer<typeof TurnReaderV7VariablesSchema>;

/**
 * v8 (founder live test 2026-09-27 #5): a screen Capital Q does not have.
 * "Take me to the queue page" was read as NAVIGATE HOME (v6: "choose the
 * most useful") and the person was moved Home without a word. Now a named
 * screen that is not a destination is NAVIGATE with destination null and
 * `unknownScreen`: what they called it, and the nearest real destination.
 * Code then says it doesn't exist and offers the nearest; nobody is moved.
 */
export const TurnUnknownScreenSchema = z
  .object({
    /** The screen as they named it. UNTRUSTED words: shown bounded, never acted on. */
    named: z.string().trim().min(1).max(60),
    /** The nearest of the real destinations, which Q offers. */
    nearest: QNavigateDestinationSchema,
  })
  .strict();
export type TurnUnknownScreen = z.infer<typeof TurnUnknownScreenSchema>;

export const TurnToolV8Schema = z
  .object({
    kind: z.enum(TURN_TOOL_V3_KINDS),
    destination: QNavigateDestinationSchema.nullable().default(null),
    unknownScreen: TurnUnknownScreenSchema.nullable().default(null),
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
            (tool.destination === null) !== (tool.unknownScreen === null) &&
            tool.visibility === null &&
            tool.documentType === null
          );
        case "SET_VISIBILITY":
          return (
            tool.visibility !== null &&
            tool.destination === null &&
            tool.unknownScreen === null &&
            tool.documentType === null
          );
        case "PREPARE_DOCUMENT":
          return (
            tool.documentType !== null &&
            tool.destination === null &&
            tool.unknownScreen === null &&
            tool.visibility === null
          );
      }
    },
    { message: "a tool carries exactly its own parameters" },
  );
export type TurnToolV8 = z.infer<typeof TurnToolV8Schema>;

export const TURN_READER_V8_SCHEMA_VERSION = 8;

export const TurnReaderV8ResultSchema = TurnReaderResultSchema.extend({
  tool: TurnToolV8Schema.nullable().default(null),
}).strict();
export type TurnReaderV8Result = z.infer<typeof TurnReaderV8ResultSchema>;

/**
 * v9 (founder live 2026-09-27, failure 7): v8 plus several documents in
 * one message. "A PDF of my mandate AND a PPTX deck for my company" held
 * one tool, so one document was made (or a question asked) and the other
 * dropped. `tool` stays the first document; `moreDocuments` holds each
 * other one asked for in the same message, in the order asked. Only
 * PREPARE_DOCUMENT may appear there: one message moves at most one screen.
 */
export const TURN_READER_V9_SCHEMA_VERSION = 9;
export const TURN_READER_MORE_DOCUMENTS_MAX = 3;

export const TurnReaderV9ResultSchema = TurnReaderV8ResultSchema.extend({
  moreDocuments: z
    .array(
      TurnToolV8Schema.refine((tool) => tool.kind === "PREPARE_DOCUMENT", {
        message: "only documents may be asked for together",
      }),
    )
    .max(TURN_READER_MORE_DOCUMENTS_MAX)
    .default([]),
}).strict();
export type TurnReaderV9Result = z.infer<typeof TurnReaderV9ResultSchema>;

/**
 * v11 (R35): v9, plus a series of questions the person asked Q to put to
 * them, or a request to stop one. The reader records the request; the
 * conversation core (question-sequence.ts) tracks progress.
 */
export const TURN_READER_V11_SCHEMA_VERSION = 11;

export const TurnReaderV11ResultSchema = TurnReaderV9ResultSchema.extend({
  sequence: QuestionSequenceReadingSchema.nullable().default(null),
}).strict();
export type TurnReaderV11Result = z.infer<typeof TurnReaderV11ResultSchema>;

/**
 * v14 (founder live 2026-09-28 #1): any answer as a document. "Give me a
 * PDF of an assessment of how I come across" fitted none of the three
 * document types, so Q truthfully said it could not make a PDF. Two types
 * close that:
 *
 *   ANSWER_EXPORT  the answer Q already gave, filed as a document exactly
 *                  as written (no model rewrites it);
 *   Q_REPORT       a new written answer on what they ask, which Q writes
 *                  and then files as a document.
 *
 * Only the document types grow; every other field and rule is v11's.
 */
export const TURN_DOCUMENT_TYPES_V14 = [
  ...TURN_DOCUMENT_TYPES_V5,
  "ANSWER_EXPORT",
  "Q_REPORT",
] as const;
export type TurnDocumentTypeV14 = (typeof TURN_DOCUMENT_TYPES_V14)[number];

export const TurnToolV14Schema = z
  .object({
    kind: z.enum(TURN_TOOL_V3_KINDS),
    destination: QNavigateDestinationSchema.nullable().default(null),
    unknownScreen: TurnUnknownScreenSchema.nullable().default(null),
    visibility: z.enum(TURN_TOOL_VISIBILITIES).nullable().default(null),
    documentType: z.enum(TURN_DOCUMENT_TYPES_V14).nullable().default(null),
    /** The company as the person named it; null when it is plainly their own, and for the types about no company. */
    subjectName: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .strict()
  .refine(
    (tool) => {
      switch (tool.kind) {
        case "NAVIGATE":
          return (
            (tool.destination === null) !== (tool.unknownScreen === null) &&
            tool.visibility === null &&
            tool.documentType === null
          );
        case "SET_VISIBILITY":
          return (
            tool.visibility !== null &&
            tool.destination === null &&
            tool.unknownScreen === null &&
            tool.documentType === null
          );
        case "PREPARE_DOCUMENT":
          return (
            tool.documentType !== null &&
            tool.destination === null &&
            tool.unknownScreen === null &&
            tool.visibility === null
          );
      }
    },
    { message: "a tool carries exactly its own parameters" },
  );
export type TurnToolV14 = z.infer<typeof TurnToolV14Schema>;

export const TURN_READER_V14_SCHEMA_VERSION = 14;

export const TurnReaderV14ResultSchema = TurnReaderResultSchema.extend({
  tool: TurnToolV14Schema.nullable().default(null),
  moreDocuments: z
    .array(
      TurnToolV14Schema.refine((tool) => tool.kind === "PREPARE_DOCUMENT", {
        message: "only documents may be asked for together",
      }),
    )
    .max(TURN_READER_MORE_DOCUMENTS_MAX)
    .default([]),
  sequence: QuestionSequenceReadingSchema.nullable().default(null),
}).strict();
export type TurnReaderV14Result = z.infer<typeof TurnReaderV14ResultSchema>;

/**
 * v15 (founder live 2026-09-29): whether spoken words were meant for Q at
 * all. Voice hears the room: a call with someone else, a colleague, a
 * lecture. Q answering those "talks to itself". False only when plainly
 * not for Q; typed words are always for Q. Defaults to true so a reading
 * that omits it is answered as before.
 */
export const TURN_READER_V15_SCHEMA_VERSION = 15;

export const TurnReaderV15ResultSchema = TurnReaderV14ResultSchema.extend({
  addressedToQ: z.boolean().default(true),
}).strict();
export type TurnReaderV15Result = z.infer<typeof TurnReaderV15ResultSchema>;

/**
 * v22 (founder live 2026-10-01): a hand-over. On a company's page "get me
 * a meeting with this person" and "handle this for me" were met with
 * "which person?" and a menu: the answer's model had to pick one of sixty
 * tools and kept asking instead. The reader now says, from meaning in any
 * language, when the person asks Q to get them a meeting with someone or
 * to take a relationship over, and code prepares Q's errand for the
 * subject on their screen, for their approval.
 *
 *   MEETING    get them a call or meeting with someone
 *   HAND_OVER  take it over / look after it / handle it for them
 */
export const TURN_HAND_OVER_KINDS = ["MEETING", "HAND_OVER"] as const;

export const TurnHandOverSchema = z
  .object({
    kind: z.enum(TURN_HAND_OVER_KINDS),
    /** Who, as they named them; null when they pointed ("this person", "them"). */
    counterpartName: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .strict();
export type TurnHandOver = z.infer<typeof TurnHandOverSchema>;

export const TURN_READER_V22_SCHEMA_VERSION = 22;

export const TurnReaderV22ResultSchema = TurnReaderV15ResultSchema.extend({
  handOver: TurnHandOverSchema.nullable().default(null),
}).strict();
export type TurnReaderV22Result = z.infer<typeof TurnReaderV22ResultSchema>;

/**
 * v24 (founder live 2026-10-01): an open microphone heard a name said to
 * someone else ("Neo, n e u") and a long dictation to the founder's
 * developer, both stored as their turns; Q then called them "Neo" and
 * summarised the dictation. addressedToQ now covers dictation meant for
 * someone else, and earlierNotForQ says when the person tells Q that what
 * they said before was not for it ("wasn't talking to you"). Code keeps
 * those lines out of what Q reads back; nothing is deleted.
 */
export const TURN_READER_V24_SCHEMA_VERSION = 24;

export const TurnReaderV24ResultSchema = TurnReaderV22ResultSchema.extend({
  earlierNotForQ: z.boolean().default(false),
}).strict();
export type TurnReaderV24Result = z.infer<typeof TurnReaderV24ResultSchema>;

/**
 * v25 (founder live 2026-10-02): "Go ahead and save it. I approve it." on
 * voice ended the call: a yes/no "stop talking?" reading said YES to an
 * approval. endVoice is part of the turn's own reading: true only when the
 * whole message is about ending this voice conversation or switching to
 * typing, and never when it also approves, asks, requests or answers.
 */
export const TURN_READER_V25_SCHEMA_VERSION = 25;

export const TurnReaderV25ResultSchema = TurnReaderV24ResultSchema.extend({
  endVoice: z.boolean().default(false),
}).strict();
export type TurnReaderV25Result = z.infer<typeof TurnReaderV25ResultSchema>;

/**
 * v27 (HARDEN P0, live 2026-10-02, Nixo): "go online, search everything …
 * I'm giving you full permission and approval to update my profile with
 * what you get online" was read as a research request, and the answer
 * model lectured about verification instead of filling the profile.
 * saveToOwnProfile is part of the turn's own reading: true when the person
 * authorises saving research or findings into their own profile; code then
 * fills the profile's open fields itself.
 */
export const TURN_READER_V27_SCHEMA_VERSION = 27;

export const TurnReaderV27ResultSchema = TurnReaderV25ResultSchema.extend({
  saveToOwnProfile: z.boolean().default(false),
}).strict();
export type TurnReaderV27Result = z.infer<typeof TurnReaderV27ResultSchema>;

/**
 * v28 (HARDEN P0, live 2026-10-02, Zino): "send a message to nixo telling
 * them I am looking forward to the next meeting" was read as a hand-over,
 * and an errand card came instead of the message; "book a meeting with
 * Nixo in the next five minutes" lost its time. A single direct request is
 * not a hand-over, and timeWindow carries a time they asked for, relative
 * to now, so code can honour it or say why not.
 */
export const TURN_READER_V28_SCHEMA_VERSION = 28;

export const TurnTimeWindowSchema = z
  .object({
    /** Minutes from now the thing may start at the earliest; null: now. */
    fromMinutes: z.number().int().min(0).max(525_600).nullable().default(null),
    /** Minutes from now it must happen by; null: no limit given. */
    toMinutes: z.number().int().min(0).max(525_600).nullable().default(null),
  })
  .strict();
export type TurnTimeWindow = z.infer<typeof TurnTimeWindowSchema>;

export const TurnReaderV28ResultSchema = TurnReaderV27ResultSchema.extend({
  timeWindow: TurnTimeWindowSchema.nullable().default(null),
}).strict();
export type TurnReaderV28Result = z.infer<typeof TurnReaderV28ResultSchema>;
