import { describe, expect, it } from "vitest";

import {
  ISO_COUNTRIES,
  countryName,
  countryOfCanonicalCode,
  countryOfIso,
  countryOfName,
  countryNamedIn,
  countryOfNodeId,
  isIsoCountryCode,
} from "../src/countries/index.js";
import { REFERENCE_TAXONOMY } from "../src/reference-data/index.js";

describe("the canonical country list", () => {
  it("is every geography node with an ISO 3166-1 code, ids as the reference data", () => {
    const nodes = REFERENCE_TAXONOMY.nodes.filter(
      (n) => n.vocabularyCode === "geography" && n.metadata.iso3166Alpha2,
    );
    expect(ISO_COUNTRIES).toHaveLength(nodes.length);
    expect(ISO_COUNTRIES.length).toBe(249);
    for (const node of nodes) {
      const country = countryOfCanonicalCode(node.canonicalCode);
      expect(country?.iso).toBe(node.metadata.iso3166Alpha2);
      expect(country?.nodeId).toBe(node.id);
      expect(country?.name).toBe(node.displayName);
      expect(countryOfNodeId(node.id)?.iso).toBe(country?.iso);
    }
    expect(new Set(ISO_COUNTRIES.map((c) => c.iso)).size).toBe(249);
  });

  it("names regions as no country", () => {
    for (const code of ["global", "west_africa", "gcc", "nordics", "europe"]) {
      expect(countryOfCanonicalCode(code)).toBeNull();
    }
    const region = REFERENCE_TAXONOMY.nodes.find(
      (n) => n.vocabularyCode === "geography" && n.canonicalCode === "nordics",
    );
    expect(countryOfNodeId(region?.id)).toBeNull();
  });

  it("knows Denmark, which the founder country list did not", () => {
    expect(countryOfIso("dk")?.name).toBe("Denmark");
    expect(isIsoCountryCode("DK")).toBe(true);
    expect(isIsoCountryCode("EU")).toBe(false);
    expect(isIsoCountryCode("other")).toBe(false);
  });

  it("names a country in English from the reference data and in Arabic from ICU", () => {
    expect(countryName("NG")).toBe("Nigeria");
    expect(countryName("CI")).toBe("Côte d'Ivoire");
    expect(countryName("DK", "ar")).toMatch(/^\p{Script=Arabic}/u);
    expect(countryName("XX")).toBeNull();
  });

  it("reads a value that is a country's name, and nothing else", () => {
    expect(countryOfName("Denmark")?.iso).toBe("DK");
    expect(countryOfName("  united states ")?.iso).toBe("US");
    expect(countryOfName("cote d'ivoire")?.iso).toBe("CI");
    expect(countryOfName("Türkiye")?.iso).toBe("TR");
    expect(countryOfName("Copenhagen, Denmark")).toBeNull();
    expect(countryOfName("somewhere nice")).toBeNull();
    expect(countryOfName("")).toBeNull();
  });
});

describe("countryNamedIn (owner, live duplex voice 9 Nov)", () => {
  it.each([
    ["USA", "US"],
    ["U.S.A.", "US"],
    ["the US", "US"],
    ["Yes, I'm in the US", "US"],
    ["It's based in um, San Francisco, California, in the USA", "US"],
    ["United States of America", "US"],
    ["United States", "US"],
    ["America", "US"],
    ["Santa Fe, New Mexico", "US"],
    ["London, UK", "GB"],
    ["Amsterdam, the Netherlands", "NL"],
    ["Lagos, Nigeria", "NG"],
    ["Côte d'Ivoire", "CI"],
  ])("%s → %s", (words, iso) => {
    expect(countryNamedIn(words)?.country.iso).toBe(iso);
  });

  it.each([
    "send it to us",
    "Springfield",
    "Atlanta, Georgia",
    "Nigeria and Ghana",
    "",
  ])("%s → none", (words) => {
    expect(countryNamedIn(words)).toBeNull();
  });

  it("returns the words that name it, as said", () => {
    expect(countryNamedIn("in the USA")?.words).toBe("the USA");
  });
});

describe("countryNamedIn: a major investor city names its country (owner, 9 Nov)", () => {
  it.each([
    ["San Francisco", "US"],
    ["San Francisco, California", "US"],
    ["New York City", "US"],
    ["Boston", "US"],
    ["Lagos", "NG"],
    ["Doha", "QA"],
    ["We're in Doha right now", "QA"],
    ["Dubai", "AE"],
    ["Abu Dhabi", "AE"],
    ["Riyadh", "SA"],
    ["Nairobi", "KE"],
    ["Cape Town", "ZA"],
    ["London", "GB"],
    ["Paris", "FR"],
    ["Berlin", "DE"],
    ["Singapore", "SG"],
    ["Hong Kong", "HK"],
    ["Toronto", "CA"],
    ["São Paulo", "BR"],
    ["Sao Paulo", "BR"],
    ["Mumbai", "IN"],
    ["Bangalore", "IN"],
    ["Bengaluru", "IN"],
    ["Lagos, Nigeria", "NG"],
  ])("%s → %s", (words, iso) => {
    expect(countryNamedIn(words)?.country.iso).toBe(iso);
  });

  it("a city and a different country together name none", () => {
    expect(countryNamedIn("London and Lagos")).toBeNull();
  });
});
