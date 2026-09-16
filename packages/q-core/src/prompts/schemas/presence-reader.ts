import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * PRESENCE_READER — what the public web already says about a subject
 * (CQ-Q-PRESENCE-001).
 *
 * The model is a reader, not a judge and not a writer. It is given a few
 * bounded excerpts from public pages and asked what each one says about
 * the subject, citing the page by index. Everything it proposes travels to
 * the Knowledge Write Gate as a candidate; nothing it says is recorded by
 * virtue of having been said.
 *
 * The key list is closed on purpose: a key it could invent would be a
 * category of understanding with no policy behind it. And the
 * `presence.signal.*` keys are observations about what somebody publicly
 * states and publishes — never a trait, never a rating, never a number.
 */

export const PRESENCE_READER_SCHEMA_NAME = "PresenceReaderResult";
export const PRESENCE_READER_SCHEMA_VERSION = 1;

export const PresenceReaderVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** PERSON, COMPANY or INVESTOR_ORGANISATION. */
    subjectType: z.enum(["PERSON", "COMPANY", "INVESTOR_ORGANISATION"]),
    /** The public name being read about. Untrusted: it is what they told us. */
    subjectName: z.string().max(160),
    /** Their own site, when known, so a page from it can be recognised. */
    subjectWebsite: z.string().max(500).nullable(),
    /** The pages, numbered. Untrusted content throughout. */
    sources: z
      .array(
        z.object({
          index: z.number().int().min(0).max(32),
          url: z.string().max(500),
          title: z.string().max(300).nullable(),
          excerpt: z.string().max(6_000),
        }),
      )
      .max(12),
  })
  .strict();
export type PresenceReaderVariables = z.infer<
  typeof PresenceReaderVariablesSchema
>;

export const PRESENCE_READER_UNTRUSTED = [
  "subjectName",
  "subjectWebsite",
  "sources",
] as const;

export const PRESENCE_KEY_VALUES = [
  "presence.self_description",
  "presence.what_they_do",
  "presence.location",
  "presence.milestone",
  "presence.signal.stated_focus",
  "presence.signal.publishes_about",
  "presence.signal.public_voice",
] as const;

export const PresenceReaderResultSchema = z
  .object({
    /** At most a dozen; fewer is better than padded. */
    understandings: z
      .array(
        z
          .object({
            key: z.enum(PRESENCE_KEY_VALUES),
            /**
             * One plain sentence about the subject, attributed in its own
             * words ("Their site describes...", "A 2025 article reports...").
             */
            statement: z.string().trim().min(8).max(400),
            /** Which pages say it. At least one, or it rests on nothing. */
            sourceIndexes: z
              .array(z.number().int().min(0).max(32))
              .min(1)
              .max(8),
          })
          .strict(),
      )
      .max(12),
    /** True when the pages are about somebody or something else entirely. */
    wrongSubject: z.boolean(),
  })
  .strict();
export type PresenceReaderResult = z.infer<typeof PresenceReaderResultSchema>;
