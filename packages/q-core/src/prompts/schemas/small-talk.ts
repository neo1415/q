import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * SMALL_TALK -- a turn the reader read as small talk ("tell me a joke",
 * "what a week", "do you like football?"), answered in one tool-free call
 * instead of the analyst with its prefetch and tool offer (RECOVERY-2026-10
 * B5, audit B-05). General conversation needs no founder or investor
 * setup: nothing here reads their records.
 */

export const SMALL_TALK_SCHEMA_NAME = "SmallTalkResult";
export const SMALL_TALK_SCHEMA_VERSION = 1;

export const SmallTalkVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the person just said. UNTRUSTED. */
    said: z.string().trim().min(1).max(1_000),
    /** The last few turns, as JSON. UNTRUSTED. */
    recentTurns: z.string().max(3_000),
  })
  .strict();
export type SmallTalkVariables = z.infer<typeof SmallTalkVariablesSchema>;

export const SMALL_TALK_UNTRUSTED = ["said", "recentTurns"] as const;

export const SmallTalkResultSchema = z
  .object({
    /** Q's reply, as said aloud or typed. */
    say: z.string().trim().min(1).max(600),
  })
  .strict();
export type SmallTalkResult = z.infer<typeof SmallTalkResultSchema>;
