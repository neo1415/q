import { z } from "zod";

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

export const InterviewAgentResultSchema = z
  .object({
    /** What Q says. Grounded in the tool results of this turn. */
    reply: z.string().trim().min(1).max(3_000),
    /**
     * The step the reply asks about, so the screen can show its choices;
     * null when it asks nothing. Code checks it is a step still open.
     */
    asking: z.string().max(80).nullable().default(null),
  })
  .strict();
export type InterviewAgentResult = z.infer<typeof InterviewAgentResultSchema>;
