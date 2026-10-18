import { describe, expect, it } from "vitest";

import {
  isTransposition,
  parseCompanySearch,
  scoreCompanySearch,
  searchKey,
  trigramSimilarity,
  type CompanySearchDocument,
} from "../src/index.js";

const doc = (
  name: string,
  more: Partial<CompanySearchDocument> = {},
): CompanySearchDocument => ({
  name,
  shortDescription: null,
  country: null,
  stage: null,
  ...more,
});

const NETWORK: readonly CompanySearchDocument[] = [
  doc("Anchor", {
    country: "NG",
    stage: "seed",
    labels: ["Fintech", "Banking"],
    website: "https://www.getanchor.co",
  }),
  doc("Anchorage Labs", { country: "US", stage: "series_a" }),
  doc("Koolboks", {
    country: "NG",
    stage: "series_a",
    labels: ["Clean Energy"],
    shortDescription: "Solar-powered freezers.",
  }),
  doc("HoneyCoin", {
    country: "KE",
    stage: "seed",
    labels: ["Fintech"],
    shortDescription: "Stablecoin and fiat payment infrastructure.",
  }),
  doc("MoneyHash", {
    country: "EG",
    labels: ["Fintech", "Payment Infrastructure"],
  }),
  doc("ekko", {
    country: "GB",
    labels: ["Fintech"],
    shortDescription: "Climate actions for banks.",
  }),
  doc("Mintlify", {
    country: "US",
    stage: "series_b",
    labels: ["Developer Tools"],
    shortDescription: "Documentation platform.",
  }),
  doc("Tangible", { country: "GB", stage: "seed", labels: ["Fintech"] }),
  doc("Bumpa", { country: "NG", stage: "seed", labels: ["Ecommerce"] }),
  doc("Duplo", {
    country: "NG",
    stage: "seed",
    labels: ["Fintech", "Payments"],
  }),
  doc("F2", {
    country: "US",
    stage: "seed",
    shortDescription: "AI workflow software for private credit funds.",
  }),
  doc("Orphéa Genomics", { country: "FR", stage: "seed" }),
  doc("Yamfield Agro", {
    country: "NG",
    stage: "pre_seed",
    labels: ["Agritech"],
  }),
  doc("Ledgerline", { country: "NG", stage: "seed", labels: ["Fintech"] }),
];

/** Names in rank order, as a surface would list them. */
function search(text: string): string[] {
  const parsed = parseCompanySearch(text);
  if (parsed === null) return [];
  return NETWORK.flatMap((d) => {
    const score = scoreCompanySearch(parsed, d);
    return score === null ? [] : [{ name: d.name, score }];
  })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((r) => r.name);
}

describe("company search reading (P13)", () => {
  it("reads places, demonyms, capitals and stages out of the words", () => {
    const parsed = parseCompanySearch("Nigerian fintech seed startups");
    expect(parsed?.countries).toEqual(["NG"]);
    expect(parsed?.stages).toEqual(["seed"]);
    expect(parsed?.terms.map((t) => t.word)).toEqual(["fintech"]);
    expect(parseCompanySearch("pre-seed in Accra")?.stages).toEqual([
      "pre_seed",
    ]);
    expect(parseCompanySearch("pre-seed in Accra")?.countries).toEqual(["GH"]);
    expect(parseCompanySearch("Series A London")?.stages).toEqual(["series_a"]);
    expect(parseCompanySearch("Series A London")?.countries).toEqual(["GB"]);
    expect(parseCompanySearch("South African payments")?.countries).toEqual([
      "ZA",
    ]);
    expect(parseCompanySearch("west africa")?.countries).not.toContain("KE");
  });

  it("reads US only in capitals: 'us' is a pronoun", () => {
    expect(parseCompanySearch("US fintech")?.countries).toEqual(["US"]);
    expect(parseCompanySearch("companies like us")?.countries).toEqual([]);
  });

  it("text with no letters or digits searches nothing", () => {
    expect(parseCompanySearch("  ?! ")).toBeNull();
  });

  it("sound-alike keys fold spelling a listener cannot hear", () => {
    expect(searchKey("koolbox")).toBe(searchKey("koolboks"));
    expect(searchKey("ecko")).toBe(searchKey("ekko"));
    expect(searchKey("ancor")).toBe(searchKey("anchor"));
    expect(searchKey("bumppa")).toBe(searchKey("bumpa"));
  });

  it("trigram similarity behaves like pg_trgm: 1 for equal, 0 for disjoint, symmetric", () => {
    expect(trigramSimilarity("anchor", "anchor")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
    expect(trigramSimilarity("tangible", "tangable")).toBeCloseTo(
      trigramSimilarity("tangable", "tangible"),
    );
  });
});

describe("company search ranking (P13)", () => {
  it("the exact name ranks first, before longer names that contain it", () => {
    expect(search("Anchor")[0]).toBe("Anchor");
    expect(search("anchor").slice(0, 2)).toEqual(["Anchor", "Anchorage Labs"]);
  });

  it.each([
    ["Koolbox", "Koolboks"],
    ["Ecko", "ekko"],
    ["Ancor", "Anchor"],
    ["Bumppa", "Bumpa"],
    ["Tangable", "Tangible"],
    ["Mintlfy", "Mintlify"],
    ["Honey Coin", "HoneyCoin"],
    ["Money Hash", "MoneyHash"],
    ["F-2", "F2"],
    ["orphea", "Orphéa Genomics"],
    ["genomics", "Orphéa Genomics"],
    ["young field agro", "Yamfield Agro"],
    ["getanchor.co", "Anchor"],
    ["coin", "HoneyCoin"],
    ["Ledgerlnie", "Ledgerline"],
    ["Tagnible", "Tangible"],
  ])("finds %s as %s, first", (text, name) => {
    expect(search(text)[0]).toBe(name);
  });

  it("a described search matches place, stage and sector words, and only those", () => {
    expect(search("Nigerian fintech seed")).toEqual([
      "Anchor",
      "Duplo",
      "Ledgerline",
    ]);
    expect(search("solar Nigeria")).toEqual(["Koolboks"]);
    expect(search("stablecoin payments")).toEqual(["HoneyCoin"]);
    expect(search("documentation platform")).toEqual(["Mintlify"]);
    expect(search("private credit software")).toEqual(["F2"]);
    expect(search("climate fintech UK")).toEqual(["ekko"]);
    expect(search("payments Egypt")).toEqual(["MoneyHash"]);
  });

  it("letters typed out of order find the name; other anagrams do not", () => {
    expect(isTransposition("termly", "temrly")).toBe(true);
    expect(isTransposition("mizan", "mzian")).toBe(true);
    // Different first letter, length or letters: not a slip of the fingers.
    expect(isTransposition("mizan", "izanm")).toBe(false);
    expect(isTransposition("mizan", "mizana")).toBe(false);
    expect(isTransposition("abc", "acb")).toBe(false);
  });

  it("unknown stays unknown: a company with no stage never matches a stage filter", () => {
    expect(search("seed Egypt")).toEqual([]);
  });

  it("matches only what the profile declares, never undeclared labels", () => {
    const parsed = parseCompanySearch("fintech");
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    // Bumpa declares Ecommerce only: a fintech search does not find it.
    expect(
      scoreCompanySearch(
        parsed,
        NETWORK.find((d) => d.name === "Bumpa") ?? doc("x"),
      ),
    ).toBeNull();
  });
});
