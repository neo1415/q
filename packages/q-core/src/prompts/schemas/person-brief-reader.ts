import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * PERSON_BRIEF_READER -- what a few public pages say about one public
 * person, organisation or agency (W2, 2026-10-10).
 *
 * The model is a reader, as INVESTOR_RESEARCH_READER is: it reports what
 * the pages state and copies the page's own words. It proposes; code
 * admits (`admitAssertions` in q-research): an assertion with no quote
 * that a cited page really contains is dropped, so a preference, a view or
 * an investment interest cannot be invented, and a finance executive is
 * never turned into a venture investor by inference alone.
 */

export const PERSON_BRIEF_READER_SCHEMA_NAME = "PersonBriefReaderResult";
export const PERSON_BRIEF_READER_SCHEMA_VERSION = 1;

export const PERSON_BRIEF_READER_TOPICS = [
  "BACKGROUND",
  "CURRENT_ROLE",
  "INVESTMENT_INTERESTS",
  "SECTORS",
  "AFFILIATIONS",
  "PUBLISHED_ACTIVITY",
  "PUBLIC_STATEMENTS",
  "INTERVIEWS_AND_CONFERENCES",
  "RECURRING_TOPICS",
  "EMPHASISED_QUESTIONS",
  "MARKET_VIEWS",
  "COMMUNICATION_STYLE",
] as const;

export const PersonBriefReaderVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The name as the person asked for it. Untrusted. */
    subjectName: z.string().max(200),
    /** PERSON, ORGANIZATION or GOVERNMENT_AGENCY. */
    entityKind: z.enum(["PERSON", "ORGANIZATION", "GOVERNMENT_AGENCY"]),
    /** The pages, numbered. Untrusted content throughout. */
    sources: z
      .array(
        z.object({
          index: z.number().int().min(0).max(32),
          url: z.string().max(500),
          title: z.string().max(300).nullable(),
          publishedAt: z.string().max(40).nullable(),
          excerpt: z.string().max(6_000),
        }),
      )
      .max(10),
  })
  .strict();
export type PersonBriefReaderVariables = z.infer<
  typeof PersonBriefReaderVariablesSchema
>;

export const PERSON_BRIEF_READER_UNTRUSTED = [
  "subjectName",
  "sources",
] as const;

export const PersonBriefReaderResultSchema = z
  .object({
    /** True when the pages are about someone or something else. */
    wrongSubject: z.boolean().default(false),
    assertions: z
      .array(
        z
          .object({
            topic: z.enum(PERSON_BRIEF_READER_TOPICS),
            /** One plain sentence about the subject. */
            text: z.string().trim().min(3).max(400),
            assertionClass: z.enum([
              "VERIFIED_PUBLIC_FACT",
              "PUBLIC_STATEMENT",
              "REASONABLE_INFERENCE",
            ]),
            sourceRefs: z.array(z.number().int().min(0).max(32)).max(6),
            /** The page's own words that say it, copied exactly. */
            quote: z.string().trim().min(12).max(300),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();
export type PersonBriefReaderResult = z.infer<
  typeof PersonBriefReaderResultSchema
>;
