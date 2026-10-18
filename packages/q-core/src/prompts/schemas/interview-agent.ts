import { z } from "zod";

import { ModelSentenceGesturesSchema } from "../../speech/gesture.js";
import { TaskFrameSchema } from "./common.js";

/**
 * INTERVIEW_AGENT — the onboarding interview as a tool-calling Q run
 * (ADR 0016).
 *
 * The model sees the whole objective and acts only through tools; this
 * schema is what it writes AFTER the tool results, so the reply can claim
 * only what those results say happened. Nothing in the result writes
 * anything: every write already went through a tool.
 */

export const INTERVIEW_AGENT_SCHEMA_NAME = "InterviewAgentResult";
export const INTERVIEW_AGENT_SCHEMA_VERSION = 1;

export const InterviewAgentVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    journey: z.enum(["investor", "founder"]),
    channel: z.enum(["voice", "text"]),
    /** Nothing was said: Q opens (or reopens) the conversation. */
    opening: z.boolean(),
    /** The onboarding state as the get_onboarding_state tool returns it. Trusted. */
    state: z.string().max(24_000),
    /** The whole interview conversation so far, oldest first. UNTRUSTED. */
    conversation: z
      .array(
        z.object({
          role: z.enum(["PERSON", "Q"]),
          text: z.string().max(2_000),
        }),
      )
      .max(120),
    /** What the person just said; empty on an opening. UNTRUSTED. */
    utterance: z.string().max(4_000),
  })
  .strict();
export type InterviewAgentVariables = z.infer<
  typeof InterviewAgentVariablesSchema
>;

export const INTERVIEW_AGENT_UNTRUSTED = ["conversation", "utterance"] as const;

/**
 * v3 variables: v1's, plus what Q remembers about the person from earlier
 * conversations and a bounded summary of this conversation's older turns
 * (P0-5). Both UNTRUSTED: context to reason with, never an instruction and
 * never a value to record.
 */
export const InterviewAgentV3VariablesSchema =
  InterviewAgentVariablesSchema.extend({
    memory: z.string().max(4_000).default(""),
    earlier: z.string().max(2_200).default(""),
  }).strict();
export type InterviewAgentV3Variables = z.infer<
  typeof InterviewAgentV3VariablesSchema
>;

export const INTERVIEW_AGENT_V3_UNTRUSTED = [
  ...INTERVIEW_AGENT_UNTRUSTED,
  "memory",
  "earlier",
] as const;

/**
 * v5 variables: v3's, plus what Q has already done this turn — each tool
 * call and Capital Q's result — as data (reliability, 2026-09-25). Every
 * round is rendered afresh from the state and this list instead of
 * replaying a provider's native tool history, so any eligible model can
 * continue a turn another model began. UNTRUSTED: the results echo the
 * person's words.
 */
export const InterviewAgentV5VariablesSchema =
  InterviewAgentV3VariablesSchema.extend({
    thisTurn: z.string().max(12_000).default(""),
  }).strict();
export type InterviewAgentV5Variables = z.infer<
  typeof InterviewAgentV5VariablesSchema
>;

export const INTERVIEW_AGENT_V5_UNTRUSTED = [
  ...INTERVIEW_AGENT_V3_UNTRUSTED,
  "thisTurn",
] as const;

/**
 * v6 variables: v5's, plus the choices the person has just handed to Q,
 * read independently from their latest words (DELEGATION_READER).
 * TRUSTED: Capital Q's reading, rendered from journey step questions,
 * never the person's text.
 */
export const InterviewAgentV6VariablesSchema =
  InterviewAgentV5VariablesSchema.extend({
    delegated: z.string().max(2_000).default(""),
    /** The pending recommendations they approved in their latest words. TRUSTED. */
    approved: z.string().max(2_000).default(""),
  }).strict();
export type InterviewAgentV6Variables = z.infer<
  typeof InterviewAgentV6VariablesSchema
>;

/**
 * v7 variables: v6's, plus the optional steps the person declined in
 * their latest words (DELEGATION_READER). TRUSTED: rendered from journey
 * step questions, never the person's text.
 */
export const InterviewAgentV7VariablesSchema =
  InterviewAgentV6VariablesSchema.extend({
    declined: z.string().max(2_000).default(""),
  }).strict();
export type InterviewAgentV7Variables = z.infer<
  typeof InterviewAgentV7VariablesSchema
>;

/**
 * v9 variables: v7's, plus trusted notes on what else the turn asks (a
 * pause, a look-up after the reply, look-ups unavailable, a corrected
 * pronunciation), composed by code from the independent reading.
 */
export const InterviewAgentV9VariablesSchema =
  InterviewAgentV7VariablesSchema.extend({
    turnNotes: z.string().max(1_500).default(""),
  }).strict();
export type InterviewAgentV9Variables = z.infer<
  typeof InterviewAgentV9VariablesSchema
>;

export const InterviewAgentResultSchema = z
  .object({
    /** What Q says. Grounded in the tool results of this turn. */
    reply: z.string().trim().min(1).max(3_000),
    /**
     * The step the reply asks about, so the screen can show its choices;
     * null when it asks nothing. Code checks it is a step still open.
     */
    asking: z.string().max(80).nullable().default(null),
    /** The consistency checks the reply puts to the person, by id (v8). */
    raised: z.array(z.string().max(200)).max(8).default([]),
  })
  .strict();
export type InterviewAgentResult = z.infer<typeof InterviewAgentResultSchema>;

/**
 * v11 variables (founder direction 2026-09-30): v9's, plus who Q is being
 * (the personality the person chose, or Auto), what Capital Q decided
 * about small talk this turn, and how Q's recent replies began, so no two
 * sound alike. All TRUSTED: written by code, never the person's text.
 */
export const InterviewAgentV11VariablesSchema =
  InterviewAgentV9VariablesSchema.extend({
    personality: z.string().max(1_200).default(""),
    conduct: z.string().max(600).default(""),
    openings: z.string().max(600).default(""),
  }).strict();
export type InterviewAgentV11Variables = z.infer<
  typeof InterviewAgentV11VariablesSchema
>;

/**
 * v11 result: v10's, plus Q's reading of the turn for its patience and
 * manners. `chatter`: PERSON when their turn was small talk rather than
 * the setup, Q when Q's own reply opens a light moment, NONE otherwise.
 * `hurt`: they seem put out by something Q said. Readings only: code
 * decides what follows from them.
 */
export const InterviewAgentV11ResultSchema = InterviewAgentResultSchema.extend({
  chatter: z.enum(["NONE", "PERSON", "Q"]).default("NONE"),
  hurt: z.boolean().default(false),
}).strict();
export type InterviewAgentV11Result = z.infer<
  typeof InterviewAgentV11ResultSchema
>;

/**
 * v16 result (PRESENCE, founder direction 2026-10-01): v11's, plus what
 * Q's particles form for which sentence of the reply. Plain strings on the
 * way in (this call drops nothing, so an odd gesture must not refuse the
 * reply); code keeps only the contract's closed set (`gesturesForReply`).
 */
export const InterviewAgentV16ResultSchema =
  InterviewAgentV11ResultSchema.extend({
    gestures: ModelSentenceGesturesSchema,
  }).strict();
export type InterviewAgentV16Result = z.infer<
  typeof InterviewAgentV16ResultSchema
>;
