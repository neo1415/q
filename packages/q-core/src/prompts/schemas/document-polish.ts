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

/**
 * v2 (live 2026-10-07, wave 5b): the wire shape is roomier than the slide.
 *
 * v1 refused the whole rewrite when one bullet ran past 180 characters
 * (`slides.5.bullets.0:too_big`), and the deck shipped unpolished. A
 * length is ours to enforce, not a reason to lose every other line: v2
 * accepts long text and the caller trims it at a word boundary to the
 * slide's own limits (title 160, subtitle 240, bullet 180, six bullets),
 * logging which field it trimmed. Limits are still stated in the prompt.
 */
export const DOCUMENT_POLISH_V2_SCHEMA_VERSION = 2;
/** The wire's generous ceilings; the slide's limits are applied in code. */
export const DOCUMENT_POLISH_V2_TEXT_MAX = 600;
export const DOCUMENT_POLISH_V2_BULLETS_MAX = 12;

export const DocumentPolishV2ResultSchema = z
  .object({
    slides: z
      .array(
        z
          .object({
            number: z.number().int().min(1).max(DOCUMENT_POLISH_SLIDES_MAX),
            title: z
              .string()
              .trim()
              .min(1)
              .max(DOCUMENT_POLISH_V2_TEXT_MAX)
              .nullable(),
            subtitle: z
              .string()
              .trim()
              .min(1)
              .max(DOCUMENT_POLISH_V2_TEXT_MAX)
              .nullable(),
            bullets: z
              .array(z.string().trim().min(1).max(DOCUMENT_POLISH_V2_TEXT_MAX))
              .max(DOCUMENT_POLISH_V2_BULLETS_MAX)
              .nullable(),
          })
          .strict(),
      )
      .max(DOCUMENT_POLISH_SLIDES_MAX)
      .default([]),
  })
  .strict();
export type DocumentPolishV2Result = z.infer<
  typeof DocumentPolishV2ResultSchema
>;
