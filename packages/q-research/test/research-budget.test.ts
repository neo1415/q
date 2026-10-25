import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createPublicWebResearchService,
  RESEARCH_BOUNDS,
} from "../src/index.js";
import { RESEARCH_RUN_BUDGET } from "../src/application/research-service.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";

/**
 * Production 2026-10-25: "Who is the founder of Paystack?" fired ~25 paid
 * provider calls in one second -- up to seven searches per research call,
 * the turn's early search and the model's own each searching again. A turn
 * searches what the question needs, and a run reaches the providers a
 * bounded number of times.
 */

const actor: ActorContext = ActorContextSchema.parse({
  userId: "44444444-4444-4444-8444-444444444444",
  tenantId: "33333333-3333-4333-8333-333333333333",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorType: "HUMAN",
});

const PAGES = [
  {
    url: "https://news.example/paystack-founders",
    title: "Paystack founders Shola Akinlade and Ezra Olubi",
    snippet: "Paystack was founded by Shola Akinlade and Ezra Olubi.",
    text: "Paystack was founded in Lagos by Shola Akinlade and Ezra Olubi.",
    publishedAt: null,
    relevance: 0.9,
  },
];

const ask = (runId: string, requestedQuery: string) => ({
  actor,
  runId,
  correlationId: "cor_budget",
  requestedQuery,
  entityName: "Paystack",
  userText: "Who is the founder of Paystack?",
  subject: null,
});

describe("public research spends what the question needs", () => {
  it("one research call: two searches up front, never more", async () => {
    const provider = createFakeResearchProvider({ pages: PAGES });
    const service = createPublicWebResearchService({ provider });
    await service.research({
      ...ask("run-a", "Paystack founders"),
      alsoQueries: ["Paystack co-founders", "who started Paystack", "x"],
    });
    expect(provider.searches.length).toBeLessThanOrEqual(
      RESEARCH_BOUNDS.searchesPerResearch,
    );
  });

  it("the early search and the model's own: a run reaches the providers once, at most two searches", async () => {
    const provider = createFakeResearchProvider({ pages: PAGES });
    const service = createPublicWebResearchService({ provider });
    const first = await service.research(ask("run-b", "Paystack founder"));
    const spent = provider.searches.length;
    expect(RESEARCH_RUN_BUDGET).toBe(1);
    expect(spent).toBeLessThanOrEqual(2);
    const second = await service.research(
      ask("run-b", "Paystack founders Lagos"),
    );
    await service.research(ask("run-b", "Paystack leadership"));
    expect(provider.searches.length).toBe(spent);
    expect(second.status).toBe(first.status);
    // Another run is its own budget.
    await service.research(ask("run-c", "Paystack leadership"));
    expect(provider.searches.length).toBeGreaterThan(spent);
  });

  it("a planned job's own questions (deep research) are bounded by its plan, not the turn's budget", async () => {
    const provider = createFakeResearchProvider({ pages: PAGES });
    const service = createPublicWebResearchService({ provider });
    for (const query of ["market", "competitors", "regulation", "founders"]) {
      await service.research({
        ...ask("run-d", `Paystack ${query}`),
        userText: "Paystack market, competitors, regulation and founders",
        focused: true,
        planned: true,
      });
    }
    expect(provider.searches.length).toBeGreaterThanOrEqual(4);
  });
});
