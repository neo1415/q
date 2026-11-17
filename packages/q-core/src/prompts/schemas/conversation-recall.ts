import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * CONVERSATION_RECALL (owner live 2026-10-17): a follow-up the turn reader
 * found answered by one of Q's own earlier turns (TURN_READER v54
 * fromShown), answered from Capital Q's record of that turn in one
 * tool-free call. "So what was the second one?" after a list is answered
 * from the list Q showed, not by ranking again. When the record does not
 * hold the answer, `answerable` is false and the full path looks it up.
 */

export const CONVERSATION_RECALL_SCHEMA_NAME = "ConversationRecallResult";
export const CONVERSATION_RECALL_SCHEMA_VERSION = 1;

export const ConversationRecallVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the person just said. UNTRUSTED. */
    said: z.string().trim().min(1).max(1_000),
    /** The last few turns, as JSON. UNTRUSTED. */
    recentTurns: z.string().max(3_000),
    /** Capital Q's record of Q's earlier turns (SHOWN). UNTRUSTED: names and words from records. */
    shown: z.string().max(9_000),
    /** The T number the reading pointed at. Trusted (code). */
    turn: z.number().int().min(1).max(12),
  })
  .strict();
export type ConversationRecallVariables = z.infer<
  typeof ConversationRecallVariablesSchema
>;

export const CONVERSATION_RECALL_UNTRUSTED = [
  "said",
  "recentTurns",
  "shown",
] as const;

export const ConversationRecallResultSchema = z
  .object({
    /** Whether SHOWN holds everything the answer needs. */
    answerable: z.boolean(),
    /** Q's reply when answerable; null otherwise. */
    say: z.string().trim().min(1).max(900).nullable().default(null),
  })
  .strict();
export type ConversationRecallResult = z.infer<
  typeof ConversationRecallResultSchema
>;

export const CONVERSATION_RECALL_V2_SCHEMA_VERSION = 2;

/**
 * v2 (owner, DECISIONS 104 voice latency, 2026-11-17): the contextual
 * follow-up fast path. A same-subject follow-up ("why does it matter?",
 * "and their burn?") is answered from what this conversation already read
 * for this person -- EVIDENCE, the previous answer's own authorised
 * sources, reused only while fresh and unchanged -- and what it showed
 * (SHOWN), in one tool-free call. It may explain and reason over them;
 * every figure and name stays held to them by the claim check, and
 * anything they do not hold is `answerable: false`, so the full path
 * answers it.
 */
export const ConversationRecallV2VariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the person just said. UNTRUSTED. */
    said: z.string().trim().min(1).max(1_000),
    /** The last few turns, as JSON. UNTRUSTED. */
    recentTurns: z.string().max(3_000),
    /** Capital Q's record of Q's earlier turns (SHOWN). UNTRUSTED. */
    shown: z.string().max(9_000),
    /** What the previous answer read for them (EVIDENCE). UNTRUSTED. */
    evidence: z.string().max(40_000),
    /** How long the reply may be (spoken or typed). Trusted (code). */
    length: z.string().trim().min(1).max(300),
  })
  .strict();
export type ConversationRecallV2Variables = z.infer<
  typeof ConversationRecallV2VariablesSchema
>;

export const CONVERSATION_RECALL_V2_UNTRUSTED = [
  "said",
  "recentTurns",
  "shown",
  "evidence",
] as const;

export const ConversationRecallV2ResultSchema = z
  .object({
    /** Whether EVIDENCE and SHOWN hold everything the answer needs. */
    answerable: z.boolean(),
    /** Q's reply when answerable; null otherwise. */
    say: z.string().trim().min(1).max(1_800).nullable().default(null),
  })
  .strict();
export type ConversationRecallV2Result = z.infer<
  typeof ConversationRecallV2ResultSchema
>;
