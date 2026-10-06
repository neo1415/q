import { describe, expect, it } from "vitest";

import {
  CriterionConfigSchema,
  mandateMentions,
  readMandate as readWith,
  type MandateVocabularyNode,
} from "../src/index.js";

/**
 * The fake model of these tests (PREFERENCE_POLARITY, J7): the terms its
 * reading rules out; every other mention it reads as wanted.
 */
function readMandate(
  text: string,
  vocabulary: readonly MandateVocabularyNode[],
  excluded: readonly string[] = ["India", "Gambling"],
) {
  const terms = new Map(
    mandateMentions(text, vocabulary).map((one) => [one.id, one.term]),
  );
  return readWith(text, vocabulary, (index) => {
    const term = terms.get(String(index));
    return term === undefined ? null : excluded.includes(term);
  });
}

/** A small slice of the reference taxonomy, with obviously synthetic ids. */
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const node = (
  n: number,
  vocabularyCode: string,
  canonicalCode: string,
  displayName: string,
  parent: number | null = null,
  iso2: string | null = null,
  aliases: readonly string[] = [],
): MandateVocabularyNode => ({
  id: id(n),
  vocabularyCode,
  canonicalCode,
  displayName,
  parentNodeId: parent === null ? null : id(parent),
  iso2,
  aliases: iso2 === null ? aliases : [...aliases, iso2],
});

const VOCABULARY: readonly MandateVocabularyNode[] = [
  node(1, "company_stage", "pre_seed", "Pre-seed", null, null, [
    "preseed",
    "pre seed",
  ]),
  node(2, "company_stage", "seed", "Seed"),
  node(3, "company_stage", "series_a", "Series A"),
  node(4, "company_stage", "series_b", "Series B"),
  node(10, "geography", "global", "Global"),
  node(11, "geography", "africa", "Africa"),
  node(12, "geography", "west_africa", "West Africa", 11),
  node(13, "geography", "nigeria", "Nigeria", 12, "NG"),
  node(14, "geography", "ghana", "Ghana", 12, "GH"),
  node(15, "geography", "east_africa", "East Africa", 11),
  node(16, "geography", "kenya", "Kenya", 15, "KE"),
  node(17, "geography", "india", "India", null, "IN"),
  node(20, "industry", "fintech", "Fintech", null, null, [
    "financial technology",
  ]),
  node(21, "industry", "payments", "Payments", 20),
  node(22, "industry", "gambling", "Gambling", null, null, ["online betting"]),
  node(23, "industry", "climate", "Climate"),
];

const MANDATE = `Demo Ridge Capital (fictional) invests in pre-seed to Series A
fintech and payments companies in West Africa and Kenya. We write cheques of
$250k–$1.5m. We do not invest in online betting. We don't look at India.`;

describe("readMandate", () => {
  const reading = readMandate(MANDATE, VOCABULARY);
  const byLabel = (label: string) =>
    reading.proposals.find((p) => p.label === label);

  it("reads a stage range into every stage it spans", () => {
    expect(byLabel("Stage")?.config).toEqual({
      type: "STAGE",
      allowedStageCodes: ["pre_seed", "seed", "series_a"],
    });
  });

  it("expands a region into its countries and keeps named countries", () => {
    const geography = byLabel("Where you're based")?.config;
    expect(geography).toEqual({
      type: "GEOGRAPHY",
      allowedCountries: ["NG", "GH", "KE"],
    });
  });

  it("never reads a negated place as an allowed one, and reports it", () => {
    expect(reading.excludedPlaces).toEqual(["India"]);
  });

  it("does not read the word 'in' as India", () => {
    const other = readMandate("We invest in Nigeria.", VOCABULARY);
    expect(other.excludedPlaces).toEqual([]);
    expect(other.proposals[0]?.config).toEqual({
      type: "GEOGRAPHY",
      allowedCountries: ["NG"],
    });
  });

  it("proposes sectors, and a negated sector only as an exclusion", () => {
    expect(byLabel("Sector")?.config).toMatchObject({
      type: "TAXONOMY",
      allowedNodeIds: [id(20), id(21)],
    });
    expect(byLabel("Sectors we don't fund")?.config).toMatchObject({
      type: "EXCLUDED_TAXONOMY",
      excludedNodeIds: [id(22)],
    });
  });

  it("reads a cheque range with its currency", () => {
    expect(byLabel("Cheque size")?.config).toEqual({
      type: "CHEQUE_COMPATIBILITY",
      currency: "USD",
      minCheque: "250000",
      maxCheque: "1500000",
    });
  });

  it("produces only configurations the engine's own contract accepts", () => {
    for (const proposal of reading.proposals) {
      expect(CriterionConfigSchema.safeParse(proposal.config).success).toBe(
        true,
      );
    }
  });

  it("quotes the investor's own sentence", () => {
    expect(byLabel("Cheque size")?.quote).toContain("cheques");
  });

  it("leaves unknown unknown: no cheque without a currency, no default band", () => {
    const vague = readMandate(
      "We back seed companies and write cheques of 500k.",
      VOCABULARY,
    );
    expect(vague.proposals.map((p) => p.dimension)).toEqual(["STAGE"]);
    expect(vague.notFound).toEqual(["GEOGRAPHY", "SECTOR", "CHEQUE"]);
  });

  it("reads 'global' as no geographic rule rather than every country", () => {
    const global = readMandate(
      "Global, sector-agnostic seed fund.",
      VOCABULARY,
    );
    expect(global.proposals.some((p) => p.dimension === "GEOGRAPHY")).toBe(
      false,
    );
  });

  it("is deterministic for the same reading", () => {
    expect(readMandate(MANDATE, VOCABULARY)).toEqual(reading);
  });

  it("hands every mention to the reading, each with its own sentence", () => {
    const mentions = mandateMentions(MANDATE, VOCABULARY);
    expect(mentions.map((one) => one.term)).toEqual(
      expect.arrayContaining(["India", "Gambling", "Kenya", "Fintech"]),
    );
    expect(mentions.find((one) => one.term === "India")?.sentence).toContain(
      "India",
    );
  });

  it("without a reading proposes nothing from a mention: unknown stays unknown", () => {
    const unread = readWith(MANDATE, VOCABULARY);
    expect(unread.proposals.map((p) => p.dimension)).toEqual(["CHEQUE"]);
    expect(unread.excludedPlaces).toEqual([]);
  });
});
