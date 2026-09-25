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
