import { describe, expect, it } from "vitest";

import { identityCardBlock } from "../src/q/person-search-answer.js";

/**
 * R5: a card for a prepared entity that is a canonical (unclaimed) investor
 * organisation carries that organisation's id, so its Rehearse opens the
 * investor rehearsal; any other card carries none.
 */

const ORG = "b0075742-0000-4000-8000-0000000000c1";

const card = (investorOrganisationId?: string) => ({
  entityKind: "ORGANIZATION" as const,
  subject: {
    externalPersonId: "0a0a5a19-7007-5711-864e-3c7d2beab5f2",
    entityKind: "ORGANIZATION" as const,
    researchStatus: "PREPARED_PUBLIC_SEED" as const,
    requiresRefresh: false,
    image: {
      status: "NOT_ATTACHED" as const,
      assetUrl: null,
      attribution: null,
      licenseNote: null,
    },
    quotes: [],
    displayName: "QInvest LLC",
    nameVariants: [],
    profileUrl: null,
    role: null,
    organization: "QInvest LLC",
    location: "Doha, Qatar",
    evidenceBundleId: null,
    briefVersion: 0,
    confidence: "STRONG" as const,
    ...(investorOrganisationId === undefined ? {} : { investorOrganisationId }),
  },
  sources: [
    {
      id: "S07",
      description: null,
      evidenceClass: null,
      url: "https://example.org/qinvest",
      domain: "example.org",
      title: "QInvest",
      publishedAt: null,
      retrievedAt: "2026-10-10T00:00:00Z",
      provider: "prepared",
    },
  ],
  uncertainty: [],
  attributionLine: null,
  summary: "Qatar-based Islamic investment group.",
  enriching: false,
  actions: ["RESEARCH_FURTHER" as const, "REHEARSE" as const],
});

describe("the identity card of a prepared investor", () => {
  it("links Rehearse to the investor organisation", () => {
    const block = identityCardBlock(card(ORG));
    const external = block?.cards[0]?.external;
    expect(external?.rehearse).toBe(true);
    expect(external?.investorOrganisationId).toBe(ORG);
  });
  it("carries no investor id when the entity is not an investor organisation", () => {
    const external = identityCardBlock(card())?.cards[0]?.external;
    expect(external?.rehearse).toBe(true);
    expect(external?.investorOrganisationId ?? null).toBeNull();
  });
});
