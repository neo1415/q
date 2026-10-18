import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * SPOKEN_REPLY — Q saying a code-built answer in its own words on the
 * standard voice line (research 2026-10-07 §4, founder live 2026-10-08).
 *
 * Code decided the facts (who, which score, which ties, what is unknown,
 * how many were asked for); the model chooses only the words. What comes
 * back is checked by `spokenFidelityIssues` before a word of it is said,
 * and the fact-built fallback is said instead when it fails or is late.
 */

export const SPOKEN_REPLY_SCHEMA_NAME = "SpokenReplyResult";
export const SPOKEN_REPLY_SCHEMA_VERSION = 1;

export const SpokenReplyVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the person just said. UNTRUSTED. */
    asked: z.string().trim().min(1).max(1_000),
    /** The facts, as JSON, built by code from records. UNTRUSTED (names). */
    facts: z.string().trim().min(2).max(4_000),
    /** What Q said last on this line, so the words do not repeat. UNTRUSTED. */
    lastSaid: z.string().max(600),
  })
  .strict();
export type SpokenReplyVariables = z.infer<typeof SpokenReplyVariablesSchema>;

export const SPOKEN_REPLY_UNTRUSTED = ["asked", "facts", "lastSaid"] as const;

export const SpokenReplyResultSchema = z
  .object({
    /** The words to say, as said aloud. */
    say: z.string().trim().min(1).max(600),
  })
  .strict();
export type SpokenReplyResult = z.infer<typeof SpokenReplyResultSchema>;
