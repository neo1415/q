import { describe, expect, it } from "vitest";

import {
  aggregateTaxonomyCandidates,
  taxonomyPhrases,
  type TaxonomyPhraseCandidate,
} from "../src/domain/resolution/taxonomy-phrases.js";

/**
 * Category phrases from a sentence (CQ-Q-VOICE-001 A §5, §10-§11): only the
 * words the person affirmed, as short n-grams, bounded; and the merge of
 * what the taxonomy answered into a proposal set and a choice set.
 */

describe("taxonomyPhrases", () => {
  it("yields the content phrases of the founder's sentence and none from a negated clause", () => {
    const phrases = taxonomyPhrases(
      "We make AI software for freight forwarders and logistics companies. We're not fintech.",
    );
    expect(phrases).toEqual(
      expect.arrayContaining([
        "ai",
        "software",
        "ai software",
        "freight",
        "forwarders",
        "freight forwarders",
        "logistics",
      ]),
    );
    expect(phrases).not.toContain("fintech");
  });

  it("is bounded and deduplicated", () => {
    const long = Array.from({ length: 60 }, (_v, i) => `word${String(i)}`).join(
      " ",
    );
    const phrases = taxonomyPhrases(long);
    expect(phrases.length).toBeLessThanOrEqual(24);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("yields nothing for a sentence that only says what the company is not", () => {
    expect(taxonomyPhrases("We don't do fintech.")).toEqual([]);
  });
});

const candidate = (
  nodeId: string,
  displayName: string,
  confidence: string,
  exact = false,
): TaxonomyPhraseCandidate => ({
  nodeId,
  displayName,
  vocabularyCode: "industry",
  confidence,
  exact,
});

describe("aggregateTaxonomyCandidates", () => {
  it("settles a phrase by an exact match or a clear lexical leader, and keeps one entry per node", () => {
    const { strong, ambiguous } = aggregateTaxonomyCandidates([
      [candidate("n-log", "Logistics & Mobility", "1.0000", true)],
      [candidate("n-log", "Logistics & Mobility", "0.8500")],
      [
        candidate("n-ent", "Enterprise Software", "0.5590"),
        candidate("n-saas", "B2B SaaS", "0.3873"),
      ],
      [candidate("n-sc", "Supply Chain", "0.4000")],
    ]);
    expect(strong.map((c) => c.displayName)).toEqual([
      "Logistics & Mobility",
      "Enterprise Software",
    ]);
    expect(ambiguous).toEqual([]);
  });

  it("offers a choice when one phrase has several candidates within a hair of each other (§10)", () => {
    const { strong, ambiguous } = aggregateTaxonomyCandidates([
      [
        candidate("n-data", "Data Infrastructure", "0.6375"),
        candidate("n-api", "Developer API", "0.6375"),
        candidate("n-pay", "Payment Infrastructure", "0.5913"),
      ],
    ]);
    expect(strong).toEqual([]);
    expect(ambiguous.map((c) => c.displayName)).toEqual([
      "Data Infrastructure",
      "Developer API",
      "Payment Infrastructure",
    ]);
  });

  it("returns empty sets when the taxonomy answered nothing or only weakly", () => {
    expect(aggregateTaxonomyCandidates([[], []])).toEqual({
      strong: [],
      ambiguous: [],
    });
    expect(
      aggregateTaxonomyCandidates([[candidate("n-x", "Something", "0.3000")]]),
    ).toEqual({ strong: [], ambiguous: [] });
  });
});
