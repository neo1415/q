import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Standing instructions (ADR 0043): Q plans, code decides. The planner
 * names declared actions and their arguments; nothing it writes is
 * authority -- every step is validated against the approved grant before
 * anything runs, and a step the grant does not allow is refused or asked.
 *
 * Trust: the goal and the grant are the person's own (trusted); the
 * people and their states come from Capital Q's records, but names are
 * UNTRUSTED text. No message bodies reach the planner (ADR 0043 §6).
 */

export const INSTRUCTION_PLAN_SCHEMA_NAME = "InstructionPlanResult";
export const INSTRUCTION_PLAN_SCHEMA_VERSION = 1;

export const InstructionPlanVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    /** The goal in the person's words. Trusted. */
    goal: z.string().max(2_000),
    /** The grant in plain lines: actions with mode, hours, tone, topics, cap. Trusted. */
    grant: z.string().max(4_000),
    /** The declared actions this plan may name, each with its argument schema. Trusted. */
    actions: z.string().max(12_000),
    /** Now, as an ISO instant, and the person's time zone. Trusted. */
    now: z.string().max(80),
    /** Their relationships and candidates: ids, states, counts. Names UNTRUSTED. */
    people: z.string().max(12_000),
    /** What Q already did under this instruction, newest last. Trusted. */
    history: z.string().max(6_000),
    /** Why code refused steps of the previous plan, when re-planning. Trusted. */
    refusals: z.string().max(3_000),
  })
  .strict();
export type InstructionPlanVariables = z.infer<
  typeof InstructionPlanVariablesSchema
>;
export const INSTRUCTION_PLAN_UNTRUSTED = ["people"] as const;

export const InstructionPlanResultSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            /** A declared action name from the list, exactly. */
            action: z.string().min(1).max(80),
            /** The action's arguments as JSON text, matching its schema. */
            argumentsJson: z.string().min(2).max(4_000),
            /** For a message: which approved topic it is about; else null. */
            topic: z.string().max(120).nullable(),
            /** True when the step touches terms, valuation, money or a commitment. */
            touchesTermsOrMoney: z.boolean(),
            /** One plain sentence for the person: what and why. */
            words: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .max(10),
    /** Parts of the goal no declared action can do, each with what Q can do instead. */
    cannot: z
      .array(
        z
          .object({
            what: z.string().trim().min(3).max(200),
            reason: z.string().trim().min(3).max(300),
            instead: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type InstructionPlanResult = z.infer<typeof InstructionPlanResultSchema>;

/**
 * v2 (weekend test 6ea17898): the plan's own reading of the goal. PREPARE
 * when it asks Q to find, prepare, draft or line up things for them; then
 * code asks for every step, whatever the grant says. EXECUTE only when it
 * hands Q the doing itself.
 */
export const INSTRUCTION_PLAN_V2_SCHEMA_VERSION = 2;
export const INSTRUCTION_PLAN_REQUESTS = ["PREPARE", "EXECUTE"] as const;
export const InstructionPlanV2ResultSchema = InstructionPlanResultSchema.extend(
  {
    request: z.enum(INSTRUCTION_PLAN_REQUESTS),
  },
).strict();
export type InstructionPlanV2Result = z.infer<
  typeof InstructionPlanV2ResultSchema
>;

/**
 * v3 (QA run 40021ae5): each "can't" names what it would need. The engine
 * itself finds and matches candidates, runs on its trigger and cadence
 * (the instruction IS the schedule) and orders steps across firings; a
 * line that needs one of those is not a missing action, and code drops it.
 * A can't-line must need something no action and no engine ability covers.
 */
export const INSTRUCTION_PLAN_V3_SCHEMA_VERSION = 3;
export const INSTRUCTION_CANNOT_NEEDS = [
  /** Finding or matching people: the engine does this. */
  "DISCOVERY",
  /** A recurring time or cadence: the instruction is the schedule. */
  "SCHEDULE",
  /** One step after another: the engine orders steps over firings. */
  "SEQUENCING",
  /** Terms, valuation, money or commitments: always theirs. */
  "TERMS_OR_MONEY",
  /** Something no listed action does. */
  "NO_SUCH_ACTION",
] as const;
export const ENGINE_ABILITIES: readonly (typeof INSTRUCTION_CANNOT_NEEDS)[number][] =
  ["DISCOVERY", "SCHEDULE", "SEQUENCING"];
export const InstructionPlanV3ResultSchema =
  InstructionPlanV2ResultSchema.extend({
    cannot: z
      .array(
        z
          .object({
            what: z.string().trim().min(3).max(200),
            reason: z.string().trim().min(3).max(300),
            instead: z.string().trim().min(3).max(300),
            needs: z.enum(INSTRUCTION_CANNOT_NEEDS),
          })
          .strict(),
      )
      .max(5),
  }).strict();
export type InstructionPlanV3Result = z.infer<
  typeof InstructionPlanV3ResultSchema
>;

/**
 * v4 (QA run 8a1d57b9): four first messages were the same sentence with the
 * name changed ("I've been following Tarmacly..."), because the planner saw
 * names and ids only. It now also reads who it writes as -- the sender's
 * side and their own approved facts (declared mandate fields, or their own
 * company's network-visible profile) -- and, per person, the counterpart's
 * network-visible material with its source. Code checks every message
 * against that material before anything is sent. The result schema is v3's.
 */
export const InstructionPlanV4VariablesSchema =
  InstructionPlanVariablesSchema.extend({
    /** The sender's side and approved facts, each with its source. Trusted (their own records). */
    sender: z.string().max(3_000),
  }).strict();
export type InstructionPlanV4Variables = z.infer<
  typeof InstructionPlanV4VariablesSchema
>;

/**
 * v5 (live QA, instruction 76d6f281): each chat message says, as typed
 * fields, what kind of message it is and what its final sentence asks. Code
 * decides from the conversation itself whether a first message is still
 * possible (the planner's FIRST on a thread the sender's side already wrote
 * in is refused), and refuses MEETING unless booking is AUTO -- the model's
 * own reading of its last sentence, beside code's deterministic check, so
 * "What times work well to connect?" cannot slip past a phrase list.
 */
export const INSTRUCTION_PLAN_V5_SCHEMA_VERSION = 5;
export const INSTRUCTION_MESSAGE_KINDS = [
  /** Nothing from the sender's side in this conversation yet. */
  "FIRST",
  /** The sender's side has written before; nothing new from them to answer. */
  "FOLLOW_UP",
  /** Answers what they wrote last. */
  "REPLY",
] as const;
export const INSTRUCTION_MESSAGE_ASKS = [
  /** A substantive question about them or their company. */
  "QUESTION",
  /** A call, meeting, chat, time, slot or availability. */
  "MEETING",
  "NONE",
] as const;
const InstructionPlanStepV5Schema =
  InstructionPlanResultSchema.shape.steps.element
    .extend({
      /** For chat.message.send: the message's kind and final ask; else null. */
      message: z
        .object({
          kind: z.enum(INSTRUCTION_MESSAGE_KINDS),
          asks: z.enum(INSTRUCTION_MESSAGE_ASKS),
        })
        .strict()
        .nullable(),
    })
    .strict();
export const InstructionPlanV5ResultSchema =
  InstructionPlanV3ResultSchema.extend({
    steps: z.array(InstructionPlanStepV5Schema).max(10),
  }).strict();
export type InstructionPlanV5Result = z.infer<
  typeof InstructionPlanV5ResultSchema
>;
export type InstructionMessageKind = (typeof INSTRUCTION_MESSAGE_KINDS)[number];
export type InstructionMessageAsk = (typeof INSTRUCTION_MESSAGE_ASKS)[number];

// ---------------------------------------------------------------------------
// INSTRUCTION_THREAD_READER: the quarantined extractor (ADR 0043 §6)
// ---------------------------------------------------------------------------

/**
 * What the other side wrote reaches the planner only through this reader:
 * a model with no tools that returns typed fields -- booleans, enums,
 * indexes and one validated instant -- never free text, so nothing they
 * wrote can become words the planner reads as instructions.
 */
export const INSTRUCTION_THREAD_READER_SCHEMA_NAME = "InstructionThreadFacts";
export const INSTRUCTION_THREAD_READER_SCHEMA_VERSION = 1;

export const InstructionThreadReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The approved topics, numbered from 1. Trusted. */
    topics: z.string().max(2_000),
    /** Now, as an ISO instant, for "tomorrow" and the like. Trusted. */
    now: z.string().max(40),
    /** The latest messages, oldest first, each marked THEM or US. UNTRUSTED. */
    thread: z.string().max(12_000),
  })
  .strict();
export type InstructionThreadReaderVariables = z.infer<
  typeof InstructionThreadReaderVariablesSchema
>;
export const INSTRUCTION_THREAD_READER_UNTRUSTED = ["thread"] as const;

export const InstructionThreadFactsSchema = z
  .object({
    /** Who wrote last. */
    lastFrom: z.enum(["THEM", "US", "NONE"]),
    /** Their latest messages ask something that has not been answered. */
    asksQuestion: z.boolean(),
    /** They want a call or a meeting. */
    wantsToMeet: z.boolean(),
    /** A specific start time they proposed, ISO 8601 with offset; else null. */
    proposedTime: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u,
      )
      .nullable(),
    /** Which approved topics (1-based) their latest messages are about. */
    topicNumbers: z.array(z.number().int().min(1).max(12)).max(12),
    /** They raise terms, valuation, amounts, money, commitments or signing. */
    mentionsTermsOrMoney: z.boolean(),
    /** They said no, not now, or to stop contacting them. */
    declined: z.boolean(),
    tone: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  })
  .strict();
export type InstructionThreadFacts = z.infer<
  typeof InstructionThreadFactsSchema
>;

/**
 * v2 (QA run 8a1d57b9): what their question is about, so code can tell a
 * question Q may answer from the person's approved facts ("what's your
 * typical cheque size and do you lead?" -- declared mandate fields) from
 * one that must go to the person. A general question about a declared
 * mandate field is not terms; a deal's valuation, an amount for this
 * company, a commitment or signing still is.
 */
export const INSTRUCTION_THREAD_READER_V2_SCHEMA_VERSION = 2;
export const INSTRUCTION_QUESTION_KINDS = [
  /** Their typical or range of cheque, as declared. */
  "CHEQUE_SIZE",
  /** Whether they lead, co-invest or follow. */
  "LEAD_OR_FOLLOW",
  "SECTORS",
  "STAGES",
  "GEOGRAPHIES",
  /** Anything else. */
  "OTHER",
] as const;
export type InstructionQuestionKind =
  (typeof INSTRUCTION_QUESTION_KINDS)[number];
export const InstructionThreadFactsV2Schema =
  InstructionThreadFactsSchema.extend({
    /** What their unanswered question is about; empty when they ask nothing. */
    questionAbout: z.array(z.enum(INSTRUCTION_QUESTION_KINDS)).max(6),
  }).strict();
export type InstructionThreadFactsV2 = z.infer<
  typeof InstructionThreadFactsV2Schema
>;
