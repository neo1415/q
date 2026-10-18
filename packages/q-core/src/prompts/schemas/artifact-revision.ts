import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Rewriting a document Q already composed (QX-003F; ADR 0013).
 *
 * The narrowest useful model task in the product: it is given section
 * headings and their current prose, and the person's own words for what
 * should change, and it returns prose for the same headings. It is given
 * no facts to add, no record to read and no way to introduce a section.
 *
 * That shape is the protection. A revision cannot reach a fact the brief
 * did not already carry, because nothing carrying one is in the prompt;
 * and the caller drops any body that states a figure the record does not
 * hold, so shortening a paragraph is possible and inventing traction is
 * not.
 */
export const ARTIFACT_REVISION_SECTIONS_MAX = 24;
export const ARTIFACT_REVISION_BODY_MAX = 6_000;

export const ArtifactRevisionVariablesSchema = z
  .object({
    // Every task prompt carries the charter frame; the renderer merges it
    // in before validating, so a schema that omits it rejects its own
    // render.
    ...TaskFrameSchema,
    /** The person's own words for what should change. UNTRUSTED. */
    instruction: z.string().trim().min(1).max(2_000),
    /** The document as it stands, heading by heading. UNTRUSTED. */
    document: z.string().max(40_000),
  })
  .strict();
export type ArtifactRevisionVariables = z.infer<
  typeof ArtifactRevisionVariablesSchema
>;

export const ARTIFACT_REVISION_UNTRUSTED = ["instruction", "document"] as const;

export const ArtifactRevisionResultSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            /** Must match a heading the document already has. */
            heading: z.string().trim().min(1).max(160),
            body: z.string().trim().min(1).max(ARTIFACT_REVISION_BODY_MAX),
          })
          .strict(),
      )
      .max(ARTIFACT_REVISION_SECTIONS_MAX)
      .default([]),
  })
  .strict();
export type ArtifactRevisionResult = z.infer<
  typeof ArtifactRevisionResultSchema
>;

export const ARTIFACT_REVISION_SCHEMA_NAME = "ArtifactRevisionResult";
export const ARTIFACT_REVISION_SCHEMA_VERSION = 1;

/**
 * v2 (founder live 2026-09-29, ADR 0025): a deck's slides and its look.
 *
 * Asked to make a deck's first page a green-and-white gradient, Q filed
 * five versions that were all the same: the revision could change section
 * prose and nothing else, and a deck is drawn from its slides and its
 * direction. v2 may also rewrite slide text (under the same no-new-figures
 * check as prose) and set the colours the person named: the cover's
 * background and title ink, and the accent. Style is only ever what they
 * asked for; null otherwise.
 */
const HexColourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/);

export const ARTIFACT_REVISION_SLIDES_MAX = 20;

export const ArtifactRevisionV2ResultSchema =
  ArtifactRevisionResultSchema.extend({
    slides: z
      .array(
        z
          .object({
            /** 1-based, as the document shows it. */
            number: z.number().int().min(1).max(ARTIFACT_REVISION_SLIDES_MAX),
            title: z.string().trim().min(1).max(160).nullable().default(null),
            subtitle: z
              .string()
              .trim()
              .min(1)
              .max(240)
              .nullable()
              .default(null),
            bullets: z
              .array(z.string().trim().min(1).max(200))
              .max(6)
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(ARTIFACT_REVISION_SLIDES_MAX)
      .default([]),
    style: z
      .object({
        coverBackground: z.array(HexColourSchema).min(1).max(2).nullable(),
        coverTitleInk: HexColourSchema.nullable(),
        accent: HexColourSchema.nullable(),
      })
      .strict()
      .nullable()
      .default(null),
  }).strict();
export type ArtifactRevisionV2Result = z.infer<
  typeof ArtifactRevisionV2ResultSchema
>;
export const ARTIFACT_REVISION_V2_SCHEMA_VERSION = 2;

/**
 * v3 (founder live 2026-09-30): any document's look, not only a deck's
 * cover. Asked to make a mandate's background light brown, v2 had nowhere
 * to put it, and Q said it had updated the document. pageBackground paints
 * every page (every slide of a deck but a cover of its own); ink is the
 * text colour on it. Still only what the person asked for.
 */
export const ArtifactRevisionV3ResultSchema =
  ArtifactRevisionV2ResultSchema.extend({
    style: z
      .object({
        coverBackground: z.array(HexColourSchema).min(1).max(2).nullable(),
        coverTitleInk: HexColourSchema.nullable(),
        accent: HexColourSchema.nullable(),
        pageBackground: HexColourSchema.nullable().default(null),
        ink: HexColourSchema.nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
  }).strict();
export type ArtifactRevisionV3Result = z.infer<
  typeof ArtifactRevisionV3ResultSchema
>;
export const ARTIFACT_REVISION_V3_SCHEMA_VERSION = 3;
