import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * PITCH_SECTION_EXTRACTION — Q reads one pitch video's transcript into the
 * founder profile's standard sections (lane ov 2026-10-16: the Overview
 * fills from the pitch where the deck lacks a section).
 *
 * The Context Firewall for this reading is the input: that pitch's own
 * transcript with its moments, and nothing else -- no company record, no
 * deck, no private numbers. The section list is trusted reference data
 * (the one versioned list, FOUNDER_PROFILE_SECTIONS); the transcript is
 * untrusted. Every fact is the founder's own claim with the moment it is
 * said: the reader labels it so, never the model.
 */

export const PITCH_SECTION_EXTRACTION_SCHEMA_NAME =
  "PitchSectionExtractionResult";
export const PITCH_SECTION_EXTRACTION_SCHEMA_VERSION = 1;
/** Characters of transcript sent: a ten-minute pitch fits. */
export const PITCH_SECTION_TRANSCRIPT_MAX = 24_000;
export const PITCH_SECTION_FACTS_MAX = 6;
export const PITCH_SECTION_SECTIONS_MAX = 20;

export const PitchSectionExtractionVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** "key: Title" lines, one per section, in order. Trusted. */
    sections: z.string().min(1).max(4_000),
    /** The pitch's length in seconds, when known. Trusted. */
    durationSeconds: z.number().int().min(0).max(86_400).nullable(),
    /** The transcript, "[m:ss] words" per cue, in order. UNTRUSTED. */
    transcript: z.string().max(PITCH_SECTION_TRANSCRIPT_MAX),
  })
  .strict();
export type PitchSectionExtractionVariables = z.infer<
  typeof PitchSectionExtractionVariablesSchema
>;

export const PITCH_SECTION_EXTRACTION_UNTRUSTED = ["transcript"] as const;

export const PitchSectionFactSchema = z
  .object({
    /** A short name for what is said ("Containers cleared a month"). */
    label: z.string().trim().min(1).max(80),
    /** What the founder says, in their words or figure. */
    value: z.string().trim().min(1).max(300),
    /** The cue's moment it is said at, in whole seconds. */
    atSeconds: z.number().int().min(0).max(86_400),
  })
  .strict();
export type PitchSectionFact = z.infer<typeof PitchSectionFactSchema>;

export const PitchSectionExtractionResultSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            /** A key from the section list; anything else is dropped. */
            key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/u),
            facts: z.array(PitchSectionFactSchema).max(PITCH_SECTION_FACTS_MAX),
          })
          .strict(),
      )
      .max(PITCH_SECTION_SECTIONS_MAX),
  })
  .strict();
export type PitchSectionExtractionResult = z.infer<
  typeof PitchSectionExtractionResultSchema
>;
