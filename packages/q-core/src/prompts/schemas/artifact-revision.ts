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
