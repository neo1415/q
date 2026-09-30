import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * FOUNDER_RESEARCH_READER -- what a company's own public pages say about
 * it, so Q can offer it back during the founder's setup (founder direction
 * 2026-09-30: a background agent researches while Q interviews, and
 * confirms with the founder only what answers a question Q will ask).
 *
 * Same discipline as INVESTOR_RESEARCH_READER: a reader, not an assessor.
 * Every filled field cites a page and its exact words; code checks the
 * words are on the page; nothing is the founder's until they accept it.
 * Null is the normal answer.
 */

export const FOUNDER_RESEARCH_READER_SCHEMA_NAME =
  "FounderResearchReaderResult";
export const FOUNDER_RESEARCH_READER_SCHEMA_VERSION = 1;

const OptionSchema = z.object({
  key: z.string().max(64),
  label: z.string().max(120),
});

export const FounderResearchReaderVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The company name the founder gave. Untrusted. */
    companyName: z.string().max(160),
    /** Their own website, when they gave one. Untrusted. */
    websiteUrl: z.string().max(500).nullable(),
    /** The journey's own stages, so a reading lands on a real option. */
    stageOptions: z.array(OptionSchema).max(20),
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
export type FounderResearchReaderVariables = z.infer<
  typeof FounderResearchReaderVariablesSchema
>;

export const FOUNDER_RESEARCH_READER_UNTRUSTED = [
  "companyName",
  "websiteUrl",
  "sources",
] as const;

const CitedShape = {
  sourceIndex: z.number().int().min(0).max(32),
  quote: z.string().trim().min(3).max(300),
};

const citedText = (max: number) =>
  z
    .object({ value: z.string().trim().min(2).max(max), ...CitedShape })
    .strict()
    .nullable();

export const FounderResearchReaderResultSchema = z
  .object({
    /** True when the pages are about some other company entirely. */
    wrongSubject: z.boolean(),
    /** What the company does, one or two sentences, close to the page's words. */
    description: citedText(600),
    /** Where the company is based: an ISO 3166-1 alpha-2 country code. */
    country: citedText(2),
    /** One of stageOptions' keys, only when a page states it. */
    stage: citedText(64),
    /** Sectors or product areas it works in, in the page's words. */
    sectors: z
      .object({
        value: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
        ...CitedShape,
      })
      .strict()
      .nullable(),
    /** Team size, only when a page states it: a whole number as digits. */
    teamSize: citedText(8),
  })
  .strict();
export type FounderResearchReaderResult = z.infer<
  typeof FounderResearchReaderResultSchema
>;
