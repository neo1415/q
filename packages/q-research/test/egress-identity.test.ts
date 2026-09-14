import { describe, expect, it } from "vitest";

import { createPublicWebResearchService } from "../src/application/research-service.js";
import { composeEgressQuery } from "../src/domain/egress.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";

/**
 * Whose name leads the query (CQ-Q-RESEARCH-001 §9): the conversation's
 * company when the person did not say it; an investor's own organisation
 * only when the person is asking about themselves. An investor asking about
 * a company must never have their own name sent as the subject.
 */

const actor = {
  userId: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organisationId: "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0",
  actorType: "HUMAN",
} as unknown as Parameters<
  ReturnType<typeof createPublicWebResearchService>["research"]
>[0]["actor"];

const PAGE = {
  url: "https://directory.example.org/kobo360",
  title: "Kobo360 profile",
  snippet: "Kobo360 is a logistics platform.",
  text: "Kobo360 is a logistics platform based in Lagos.",
};

function run(
  userText: string,
  subject: Parameters<
    ReturnType<typeof createPublicWebResearchService>["research"]
  >[0]["subject"],
) {
  const provider = createFakeResearchProvider({ pages: [PAGE] });
  const service = createPublicWebResearchService({ provider });
  return service
    .research({
      actor,
      runId: "90000000-0000-4000-8000-000000000001",
      correlationId: "cor_test",
      requestedQuery: userText,
      userText,
      subject,
      extractCount: 1,
    })
    .then((outcome) => ({ outcome, provider }));
}

describe("composeEgressQuery prependIdentity", () => {
  it("keeps the identity allowed but not leading when prependIdentity is false", () => {
    const result = composeEgressQuery({
      requestedQuery: "Kobo360 markets",
      userText: "What does the public web say about Kobo360 markets?",
      publicIdentity: ["Meridian Ventures"],
      prependIdentity: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.query).not.toContain("meridian");
    expect(result.query).toContain("kobo360");
  });
});

describe("research service: whose name leads the query", () => {
  it("does not send an investor's own name when they ask about another company", async () => {
    const { outcome, provider } = await run(
      "What does the public web say about Kobo360, and what does Capital Q have on record about it?",
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: "d0000000-0000-4000-8000-000000000001",
        name: "Meridian Ventures",
        identityAuthorised: true,
      },
    );
    expect(outcome.status).toBe("OK");
    expect(provider.egressed().toLowerCase()).not.toContain("meridian");
    expect(provider.egressed().toLowerCase()).toContain("kobo360");
  });

  it("leads with the investor's own name when they ask about themselves", async () => {
    const { outcome, provider } = await run(
      "What does the public web say about us and our reputation?",
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: "d0000000-0000-4000-8000-000000000001",
        name: "Meridian Ventures",
        identityAuthorised: true,
      },
    );
    expect(outcome.status).toBe("OK");
    expect(provider.egressed()).toContain("Meridian Ventures");
  });

  it("still leads with the company's name when the conversation is about that company", async () => {
    const { provider } = await run(
      "Which markets does the public web say we operate in?",
      {
        kind: "COMPANY",
        companyId: "c0000000-0000-4000-8000-000000000001",
        name: "Kobo360",
        websiteUrl: "https://kobo360.com",
        headquartersCountry: "NG",
        identityAuthorised: true,
        persistAsEvidence: false,
      },
    );
    expect(provider.egressed()).toContain("Kobo360");
  });
});
