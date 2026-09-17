import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * DECISION_READER — was that a yes, a no, or something else? (ADR 0011)
 *
 * Q has asked one closed question ("Shall I go ahead?", "Is that you?",
 * "Switch it on?") and the person has said something. Whether what they
 * said answers it is a matter of meaning, and meaning is read by a model:
 * "Approved.", "sure, why not", "no, leave it", "hang on, what does that
 * change?" and "yes but call me John" are all different, and a list of
 * words never covered them. The model fills this closed shape; code
 * decides what a YES is allowed to do and does it, or not.
 *
 * `remainder` is what they said beyond the decision, in their words, so
 * "yes, and change my website too" is a yes AND a next turn. The runtime
 * checks it is really a piece of the utterance before it carries it on.
 */

export const DECISION_READER_SCHEMA_NAME = "DecisionReaderResult";
export const DECISION_READER_SCHEMA_VERSION = 1;

export const DecisionReaderVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The closed question Q asked, in Q's own words. Trusted. */
    question: z.string().trim().min(1).max(600),
    /** The last few turns before it, oldest first. UNTRUSTED. */
    recentTurns: z
      .array(
        z.object({
          role: z.enum(["USER", "Q"]),
          text: z.string().max(400),
        }),
      )
      .max(6),
    /** What the person said in reply. UNTRUSTED. */
    utterance: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type DecisionReaderVariables = z.infer<
  typeof DecisionReaderVariablesSchema
>;

export const DECISION_READER_UNTRUSTED = ["recentTurns", "utterance"] as const;

export const DECISIONS = ["YES", "NO", "UNRELATED"] as const;
export type Decision = (typeof DECISIONS)[number];

export const DecisionReaderResultSchema = z
  .object({
    decision: z.enum(DECISIONS),
    /**
     * Whatever they said beyond answering, verbatim from the utterance, or
     * null. Never a paraphrase: the runtime checks it against the words.
     */
    remainder: z.string().trim().max(1_000).nullable().default(null),
  })
  .strict();
export type DecisionReaderResult = z.infer<typeof DecisionReaderResultSchema>;
