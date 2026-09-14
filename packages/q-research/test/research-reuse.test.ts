import { describe, expect, it } from "vitest";

import { createPublicWebResearchService } from "../src/application/research-service.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";

/**
 * One successful bounded research per run and query (CQ-Q-VOICE-001 R4).
 * A model round, the deterministic seam call and an answer retry that ask
 * the same question in the same run share one result: one search, one
 * extract, one set of evidence writes. A different run, or a different
 * question, is a new research.
 */

const actor = {
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
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

function harness() {
  const provider = createFakeResearchProvider({ pages: [PAGE] });
  const registered: string[] = [];
  const service = createPublicWebResearchService({
    provider,
    evidence: {
      listSources: () =>
        Promise.resolve(
          registered.map((url, i) => ({
            id: `src-${String(i)}`,
            sourceUrl: url,
          })),
        ),
      registerSource: (_actor, input) => {
        registered.push(input.sourceUrl);
        return Promise.resolve({ id: `src-${String(registered.length)}` });
      },
      listItems: () => Promise.resolve([]),
      createItem: () => Promise.resolve({ id: "item" }),
    },
  });
  const research = (runId: string, userText: string) =>
    service.research({
      actor,
      runId,
      correlationId: "cor_test",
      requestedQuery: userText,
      userText,
      subject: {
        kind: "COMPANY",
        companyId: "c0000000-0000-4000-8000-000000000001",
        name: "Kobo360",
        websiteUrl: "https://kobo360.com",
        headquartersCountry: "NG",
        identityAuthorised: true,
        persistAsEvidence: true,
      },
      extractCount: 1,
    });
  return { provider, registered, research };
}

describe("research reuse within a run", () => {
  it("answers the same question in the same run from the first result, with no second provider call or evidence write", async () => {
    const h = harness();
    const run = "90000000-0000-4000-8000-000000000001";
    const first = await h.research(
      run,
      "What does the public web say about Kobo360?",
    );
    const second = await h.research(
      run,
      "What does the public web say about Kobo360?",
    );
    expect(first.status).toBe("OK");
    expect(second).toBe(first);
    expect(h.provider.searches).toHaveLength(1);
    expect(h.provider.extracts).toHaveLength(1);
    expect(h.registered).toHaveLength(1);
  });

  it("researches again for a different run or a different question", async () => {
    const h = harness();
    await h.research("90000000-0000-4000-8000-000000000001", "Kobo360 markets");
    await h.research("90000000-0000-4000-8000-000000000002", "Kobo360 markets");
    await h.research("90000000-0000-4000-8000-000000000002", "Kobo360 funding");
    expect(h.provider.searches).toHaveLength(3);
  });
});
