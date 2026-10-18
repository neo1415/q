import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * PROFILE_GAP_READER -- public sources mapped onto the OPEN fields of a
 * founder's own company profile, and nothing else (HARDEN P0, live
 * 2026-10-02: given the founder's permission to fill their profile from
 * what is online, the answer model argued about verification instead).
 *
 * A reader, not an analyst: one value per open field a source states, in
 * the field's own form, with the source's index and its exact words. Code
 * checks the words are in that source, keeps only open fields, drops
 * fields the sources disagree on, and prepares one change for approval.
 */

export const PROFILE_GAP_READER_SCHEMA_NAME = "ProfileGapReaderResult";
export const PROFILE_GAP_READER_SCHEMA_VERSION = 1;

export const ProfileGapReaderVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The company's name on Capital Q. Untrusted (the founder typed it). */
    companyName: z.string().max(160),
    /** The open fields, each with the form its value takes. */
    openFields: z
      .array(
        z.object({ field: z.string().max(64), form: z.string().max(2_000) }),
      )
      .max(12),
    /** The sources, numbered. Untrusted content throughout. */
    sources: z
      .array(
        z.object({
          index: z.number().int().min(1).max(32),
          url: z.string().max(500),
          title: z.string().max(300).nullable(),
          excerpt: z.string().max(4_000),
        }),
      )
      .max(8),
  })
  .strict();
export type ProfileGapReaderVariables = z.infer<
  typeof ProfileGapReaderVariablesSchema
>;

export const PROFILE_GAP_READER_UNTRUSTED = ["companyName", "sources"] as const;

export const ProfileGapReaderResultSchema = z
  .object({
    /** True when the sources are about some other company entirely. */
    wrongSubject: z.boolean().default(false),
    values: z
      .array(
        z
          .object({
            field: z.string().max(64),
            value: z.string().trim().min(1).max(2_000),
            sources: z.array(z.number().int().min(1).max(32)).min(1).max(5),
            /** The source's own words that state it, copied exactly. */
            quote: z.string().trim().min(2).max(300),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    /** Open fields the sources state differently. */
    conflicting: z.array(z.string().max(64)).max(12).default([]),
  })
  .strict();
export type ProfileGapReaderResult = z.infer<
  typeof ProfileGapReaderResultSchema
>;
