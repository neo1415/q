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
