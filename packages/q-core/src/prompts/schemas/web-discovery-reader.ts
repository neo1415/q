import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * WEB_DISCOVERY_READER -- the specific companies, and their founders, that
 * a few public pages name (owner 2026-11-06, Savanna Seed Partners: "find
 * me new companies online and their founders" stopped at directory pages).
 *
 * The model is a reader, as PERSON_BRIEF_READER is: it lists what the pages
 * name and copies the page's own words. It proposes; code admits
 * (`admitDiscoveries` in model-gateway): a company or founder whose name is
 * not on a cited page is dropped, so nothing can come from model memory.
 * The prompt holds public page text and public taxonomy words only; no
 * Capital Q record, figure or note is ever in it.
 */

export const WEB_DISCOVERY_READER_SCHEMA_NAME = "WebDiscoveryReaderResult";
export const WEB_DISCOVERY_READER_SCHEMA_VERSION = 1;

export const WEB_DISCOVERY_READER_PAGES_MAX = 12;
export const WEB_DISCOVERY_READER_COMPANIES_MAX = 16;

export const WebDiscoveryReaderVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /**
     * What kind of company is looked for, in public taxonomy words only
     * ("fintech, enterprise software; pre-seed to Series A; Nigeria, United
     * Kingdom"). Composed by code from category codes; never a figure.
     */
    looking: z.string().max(600),
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
      .max(WEB_DISCOVERY_READER_PAGES_MAX),
  })
  .strict();
export type WebDiscoveryReaderVariables = z.infer<
  typeof WebDiscoveryReaderVariablesSchema
>;

export const WEB_DISCOVERY_READER_UNTRUSTED = ["sources"] as const;

const nullableShort = (max: number) =>
  z.string().trim().min(1).max(max).nullable().default(null).catch(null);

export const WebDiscoveryCompanySchema = z
  .object({
    /** The company's name exactly as a page writes it. */
    name: z.string().trim().min(2).max(120),
    /** Founder names exactly as a page writes them; empty when none is named. */
    founders: z
      .array(z.string().trim().min(3).max(120))
      .max(4)
      .default([])
      .catch([]),
    /** What it does, in a few plain words a page supports; null when no page says. */
    does: nullableShort(200),
    /** Sector in plain words as a page states it; null when unstated. */
    sector: nullableShort(80),
    /** Funding stage as a page states it ("seed", "Series A"); null when unstated. */
    stage: nullableShort(40),
    /** Country or city as a page states it; null when unstated. */
    place: nullableShort(80),
    /** The pages that name it (their index). */
    sourceRefs: z.array(z.number().int().min(0).max(32)).min(1).max(6),
    /** A page's own words naming it, copied exactly. */
    quote: z.string().trim().min(6).max(300),
  })
  .strict();
export type WebDiscoveryCompany = z.infer<typeof WebDiscoveryCompanySchema>;

export const WebDiscoveryReaderResultSchema = z
  .object({
    companies: z
      .array(WebDiscoveryCompanySchema)
      .max(WEB_DISCOVERY_READER_COMPANIES_MAX)
      .default([]),
  })
  .strict();
export type WebDiscoveryReaderResult = z.infer<
  typeof WebDiscoveryReaderResultSchema
>;
