import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * INVESTOR_RESEARCH_READER — what an investor's own public sources say
 * about how they invest (BIZ-009, R13).
 *
 * The model is a reader: it is handed a few bounded public pages (the
 * firm's website, a profile link the person gave, a public registry
 * record) and reads them into the mandate's own shape. Every field it
 * fills carries the page it came from and the exact words on that page;
 * code checks the words are really there before anything is offered to
 * the person, and nothing becomes theirs until they accept it.
 *
 * Every field is nullable and null is the normal answer: a page that says
 * nothing about cheque size leaves the cheque unknown. Amounts are
 * decimal strings, never floats, with the currency beside them.
 */

export const INVESTOR_RESEARCH_READER_SCHEMA_NAME =
  "InvestorResearchReaderResult";
export const INVESTOR_RESEARCH_READER_SCHEMA_VERSION = 1;

const OptionSchema = z.object({
  key: z.string().max(64),
  label: z.string().max(120),
});

export const InvestorResearchReaderVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The firm name the person gave. Untrusted: it is what they told us. */
    firmName: z.string().max(160),
    /** Their own website, when they gave one. */
    websiteUrl: z.string().max(500).nullable(),
    /** The journey's own choices, so a reading lands on a real option. */
    investorTypeOptions: z.array(OptionSchema).max(20),
    stageOptions: z.array(OptionSchema).max(20),
    currencyOptions: z.array(OptionSchema).max(30),
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
export type InvestorResearchReaderVariables = z.infer<
  typeof InvestorResearchReaderVariablesSchema
>;

export const INVESTOR_RESEARCH_READER_UNTRUSTED = [
  "firmName",
  "websiteUrl",
  "sources",
] as const;

/** Where a reading came from: one page, and its words, verbatim. */
const CitedShape = {
  /** Which page says it. */
  sourceIndex: z.number().int().min(0).max(32),
  /** The page's own words that say it, copied exactly. */
  quote: z.string().trim().min(3).max(300),
};

const citedText = (max: number) =>
  z
    .object({ value: z.string().trim().min(2).max(max), ...CitedShape })
    .strict()
    .nullable();

const citedList = (maxItems: number) =>
  z
    .object({
      value: z.array(z.string().trim().min(1).max(120)).min(1).max(maxItems),
      ...CitedShape,
    })
    .strict()
    .nullable();

/** A plain non-negative decimal amount, in whole units of the currency. */
const AmountSchema = z.string().trim().max(20).nullable();

export const InvestorResearchReaderResultSchema = z
  .object({
    /** True when the pages are about some other firm or person entirely. */
    wrongSubject: z.boolean(),
    /** One of investorTypeOptions' keys. */
    investorType: citedText(64),
    /** Their stated thesis, one or two sentences, close to the page's words. */
    thesis: citedText(400),
    /** stageOptions' keys. */
    stages: citedList(5),
    /** Sectors or product areas they say they invest in, in the page's words. */
    sectors: citedList(8),
    /** Regions or countries they say they invest in, in the page's words. */
    geographies: citedList(8),
    /** Cheque size, only when a page states it. */
    cheque: z
      .object({
        /** One of currencyOptions' keys. */
        currency: z.string().trim().max(8),
        min: AmountSchema,
        typical: AmountSchema,
        max: AmountSchema,
        ...CitedShape,
      })
      .strict()
      .nullable(),
    /** Portfolio company names the pages list, at most a dozen. */
    portfolio: citedList(12),
  })
  .strict();
export type InvestorResearchReaderResult = z.infer<
  typeof InvestorResearchReaderResultSchema
>;
