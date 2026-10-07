import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * DOCUMENT_CRITIQUE (deck wave 8): a vision check of a rendered deck. The
 * pages ride as images on the messages (at most twelve); the model scores
 * content, design and coherence 1-5 and may ask only for typed fixes,
 * which code applies. It never edits the deck and never judges whether a
 * number is true (grounding is checked by code against the record).
 */

export const DOCUMENT_CRITIQUE_SCHEMA_NAME = "DocumentCritiqueResult";
export const DOCUMENT_CRITIQUE_SCHEMA_VERSION = 1;
export const DOCUMENT_CRITIQUE_PAGES_MAX = 12;
export const DOCUMENT_CRITIQUE_FIX_KINDS = [
  "SHORTEN_BODY",
  "DROP_IMAGE",
  "DEDUPE_TITLE",
] as const;

export const DocumentCritiqueVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The deck's slide titles, numbered as the pages are. UNTRUSTED. */
    outline: z.string().max(4_000),
  })
  .strict();
export type DocumentCritiqueVariables = z.infer<
  typeof DocumentCritiqueVariablesSchema
>;

export const DOCUMENT_CRITIQUE_UNTRUSTED = ["outline"] as const;

const Score = z.number().int().min(1).max(5);

export const DocumentCritiqueResultSchema = z
  .object({
    rubric: z
      .object({ content: Score, design: Score, coherence: Score })
      .strict(),
    fixes: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(DOCUMENT_CRITIQUE_PAGES_MAX),
            kind: z.enum(DOCUMENT_CRITIQUE_FIX_KINDS),
            reason: z.string().trim().max(200).nullable(),
          })
          .strict(),
      )
      .max(24)
      .default([]),
  })
  .strict();
export type DocumentCritiqueResult = z.infer<
  typeof DocumentCritiqueResultSchema
>;
