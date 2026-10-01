import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * DOCUMENT_POLISH (DOCS spec §5 "words"): the wording pass over a deck Q
 * just composed, so it reads like a founder wrote it and not like a model
 * did. Rewording only: the prompt carries the deck's own slides and
 * nothing else, and the caller drops any line that states a figure the
 * deck's grounding does not carry.
 */
export const DOCUMENT_POLISH_SLIDES_MAX = 24;
export const DOCUMENT_POLISH_SCHEMA_NAME = "DocumentPolishResult";
export const DOCUMENT_POLISH_SCHEMA_VERSION = 1;

export const DocumentPolishVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The deck's slides, numbered, as the composer wrote them. UNTRUSTED. */
    document: z.string().max(30_000),
  })
  .strict();
export type DocumentPolishVariables = z.infer<
  typeof DocumentPolishVariablesSchema
>;

export const DOCUMENT_POLISH_UNTRUSTED = ["document"] as const;

export const DocumentPolishResultSchema = z
  .object({
    slides: z
      .array(
        z
          .object({
            number: z.number().int().min(1).max(DOCUMENT_POLISH_SLIDES_MAX),
            /** A new title, or null to keep it. */
            title: z.string().trim().min(1).max(160).nullable(),
            subtitle: z.string().trim().min(1).max(240).nullable(),
            bullets: z
              .array(z.string().trim().min(1).max(180))
              .max(6)
              .nullable(),
          })
          .strict(),
      )
      .max(DOCUMENT_POLISH_SLIDES_MAX)
      .default([]),
  })
  .strict();
export type DocumentPolishResult = z.infer<typeof DocumentPolishResultSchema>;
