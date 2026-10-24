import { describe, expect, it } from "vitest";

import { IdentityCardSchema } from "@capital-q/contracts/q";

import { investorCardsBlock } from "../src/q/investor-discovery-answer.js";

/**
 * Coordinator 2026-10-24: a founder may rehearse a call with any investor
 * Q discovers (D1); an investor asking for investors -- co-investors --
 * has no pitch to rehearse with them, so their cards offer to look into
 * each one further instead.
 */
const found = (name: string) => ({
  card: IdentityCardSchema.parse({
    entityKind: "ORGANIZATION",
    subject: {
      externalPersonId: "5f0c3b8e-1d2a-4c6b-9e7f-0a1b2c3d4e5f",
      entityKind: "ORGANIZATION",
      displayName: name,
      nameVariants: [],
      profileUrl: null,
      role: null,
      organization: null,
      location: "Qatar",
      evidenceBundleId: null,
      briefVersion: 0,
      confidence: "STRONG",
    },
    sources: [
      {
        url: "https://example.org/doha-tech-angels",
        domain: "example.org",
        title: name,
        publishedAt: null,
        retrievedAt: "2026-10-24T10:00:00.000Z",
        provider: "prepared",
      },
    ],
    uncertainty: [],
    enriching: false,
    actions: ["RESEARCH_FURTHER", "REHEARSE"],
  }),
  role: "INVESTOR" as const,
  fit: ["Based in Qatar."],
  source: "KNOWN_ENTITY" as const,
});

describe("discovered investor cards: rehearse is a founder's", () => {
  it("a founder can rehearse with them", () => {
    const block = investorCardsBlock([found("Doha Tech Angels")], "Qatar");
    expect(JSON.stringify(block)).toContain('"rehearse":true');
    expect(block?.followUps).toEqual(["Rehearse with Doha"]);
  });

  it("an investor is offered to look into them further, never a rehearsal", () => {
    const block = investorCardsBlock(
      [found("Doha Tech Angels")],
      "Qatar",
      false,
    );
    expect(block?.cards).toHaveLength(1);
    expect(JSON.stringify(block)).not.toContain('"rehearse":true');
    expect(block?.followUps).toEqual(["Look into Doha Tech Angels further"]);
  });
});
