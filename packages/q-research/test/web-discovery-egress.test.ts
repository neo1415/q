import { describe, expect, it } from "vitest";

import { createPublicWebResearchService } from "../src/application/research-service.js";
import { RESEARCH_DISCOVERY_RUN_BUDGET } from "../src/application/research-service.js";
import { categoryTerms } from "../src/domain/category-terms.js";
import { ResearchProviderFailure } from "../src/ports.js";
import type { PublicWebResearchProvider } from "../src/ports.js";
import { withCircuitBreaker } from "../src/providers/breaker.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";

/**
 * Web discovery (owner 2026-11-06, Savanna Seed Partners). The egress
 * policy lets out only the person's own words, so a search planned from
 * the mandate lost every category the person had not said. Two channels
 * now carry public words, each decided by data, never by the caller:
 *  - `categories`: only real reference-taxonomy nodes and ISO countries,
 *    by their public names;
 *  - `pageNames`: only names whose every word was on a page this run's
 *    searches surfaced.
 * Discovery calls have their own strict budget per run; ordinary turns
 * keep the one-call rule.
 */

type Command = Parameters<
  ReturnType<typeof createPublicWebResearchService>["research"]
>[0];

const actor = {
  userId: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organisationId: "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0",
  actorType: "HUMAN",
} as unknown as Command["actor"];

const RUN = "90000000-0000-4000-8000-0000000000d1";

const DIRECTORY = {
  url: "https://directory.example.org/nigeria-fintech",
  title: "Nigerian fintech startups",
  snippet: "Nigerian fintech startups raising this year.",
  text: "Nigerian fintech startups raising this year: Owo Rails, a payments API for Lagos merchants, and Kobo Harbour, a savings app in Ibadan.",
};

const command = (overrides: Partial<Command>): Command => ({
  actor,
  runId: RUN,
  correlationId: "cor_test",
  requestedQuery: "fintech startups Nigeria pre-seed 2026",
  userText: "hey, find me new companies online and their founders",
  subject: null,
  extractCount: 1,
  ...overrides,
});

describe("categoryTerms: reference data decides what may travel", () => {
  it("admits real taxonomy nodes and ISO countries, by their public names", () => {
    const terms = categoryTerms({
      sectors: ["fintech", "enterprise_software"],
      stages: ["pre_seed", "series_a"],
      countries: ["NG", "gb"],
    });
    for (const name of [
      "Fintech",
      "Enterprise Software",
      "Pre-seed",
      "Series A",
      "Nigeria",
      "United Kingdom",
    ]) {
      expect(terms).toContain(name);
    }
  });

  it("drops a made-up category that spells a private note, and anything not a country", () => {
    const terms = categoryTerms({
      sectors: ["kestrel_side_letter", "runway_9_months"],
      stages: ["250000"],
      countries: ["ZZ", "Kestrel"],
      regions: ["not_a_region"],
    });
    expect(terms).toEqual([]);
  });
});

describe("research service: discovery egress", () => {
  it("sends the mandate's categories the person never said, and never a figure", async () => {
    const provider = createFakeResearchProvider({ pages: [DIRECTORY] });
    const service = createPublicWebResearchService({ provider });
    // Without categories: the person's words only.
    await service.research(
      command({
        runId: `${RUN}-a`,
        requestedQuery: "fintech startups Nigeria pre-seed 2026",
      }),
    );
    const before = provider.searches.map((s) => s.query).join(" | ");
    expect(before).not.toContain("nigeria");
    expect(before).not.toContain("fintech");
    // With them: the categories travel, the year with them.
    const from = provider.searches.length;
    await service.research(
      command({
        runId: `${RUN}-b`,
        requestedQuery: "fintech startups Nigeria pre-seed 2026 USD 250000",
        categories: {
          sectors: ["fintech"],
          countries: ["NG"],
          stages: ["pre_seed"],
        },
      }),
    );
    const after = provider.searches
      .slice(from)
      .map((s) => s.query)
      .join(" | ");
    expect(after).toContain("fintech");
    expect(after).toContain("nigeria");
    expect(after).toContain("pre");
    expect(after).toContain("2026");
    expect(after).not.toContain("250000");
    expect(after).not.toContain("usd");
  });

  it("searches a name only when this run's pages carried it", async () => {
    const provider = createFakeResearchProvider({ pages: [DIRECTORY] });
    const service = createPublicWebResearchService({ provider });
    // Round one surfaces the directory in this run.
    await service.research(
      command({ categories: { sectors: ["fintech"], countries: ["NG"] } }),
    );
    const searched = provider.searches.length;
    await service.research(
      command({
        requestedQuery: "Kobo Harbour founder Kestrel",
        pageNames: ["Kobo Harbour", "Kestrel Partners"],
      }),
    );
    const founderQueries = provider.searches
      .slice(searched)
      .map((s) => s.query);
    expect(founderQueries.join(" | ")).toContain("kobo harbour founder");
    expect(founderQueries.join(" | ")).not.toContain("kestrel");
    // The person's own sentence is not searched again for a founder round.
    expect(founderQueries.join(" | ")).not.toContain("companies online");
    // A name no page of another run carried is never admitted.
    const other = provider.searches.length;
    await service.research(
      command({
        runId: `${RUN}-other`,
        requestedQuery: "Kobo Harbour founder",
        pageNames: ["Kobo Harbour"],
      }),
    );
    expect(
      provider.searches
        .slice(other)
        .map((s) => s.query)
        .join(" | "),
    ).not.toContain("kobo harbour");
  });

  it("holds discovery to its own budget per run, side by side included", async () => {
    const provider = createFakeResearchProvider({ pages: [DIRECTORY] });
    const service = createPublicWebResearchService({ provider });
    const outcomes = await Promise.all(
      Array.from({ length: RESEARCH_DISCOVERY_RUN_BUDGET + 3 }, (_, i) =>
        service.research(
          command({
            requestedQuery: `fintech startups Nigeria ${String(i)}`,
            categories: { sectors: ["fintech"], countries: ["NG"] },
          }),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === "OK")).toHaveLength(
      RESEARCH_DISCOVERY_RUN_BUDGET,
    );
    expect(provider.searches.length).toBeLessThanOrEqual(
      RESEARCH_DISCOVERY_RUN_BUDGET * 2,
    );
  });

  it("an ordinary turn keeps the one-call rule", async () => {
    const provider = createFakeResearchProvider({ pages: [DIRECTORY] });
    const service = createPublicWebResearchService({ provider });
    await service.research(command({ requestedQuery: "fintech startups" }));
    const first = provider.searches.length;
    await service.research(command({ requestedQuery: "payments startups" }));
    expect(provider.searches.length).toBe(first);
  });
});

describe("provider health on the 6 Nov production keys", () => {
  it("ScrapingBee (401) and Serper (402) rest after one refusal; Brave and Tavily carry the searches", async () => {
    const calls: Record<string, number> = {};
    const refusing = (
      code: string,
      status: number,
      failureClass: ResearchProviderFailure["failureClass"],
    ): PublicWebResearchProvider => ({
      code: code as PublicWebResearchProvider["code"],
      search: () => {
        calls[code] = (calls[code] ?? 0) + 1;
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: code as PublicWebResearchProvider["code"],
            failureClass,
            status,
          }),
        );
      },
      extract: () => Promise.reject(new Error("not used")),
    });
    const answering = (
      code: string,
      url: string,
    ): PublicWebResearchProvider => ({
      code: code as PublicWebResearchProvider["code"],
      search: () => {
        calls[code] = (calls[code] ?? 0) + 1;
        return Promise.resolve({
          hits: [
            {
              url,
              title: code,
              snippet: "Owo Rails",
              publishedAt: null,
              relevance: null,
            },
          ],
          latencyMs: 1,
        });
      },
      extract: () => Promise.reject(new Error("not used")),
    });
    const merged = createFallbackResearchProvider({
      providers: [
        withCircuitBreaker(refusing("scrapingbee", 401, "AUTHENTICATION")),
        withCircuitBreaker(refusing("serper", 402, "UNAVAILABLE")),
        withCircuitBreaker(answering("brave", "https://brave.example.org/a")),
        withCircuitBreaker(answering("tavily", "https://tavily.example.org/b")),
      ],
      parallelSearch: true,
    });
    const request = {
      query: "fintech startups nigeria",
      maxResults: 6,
      freshness: "ANY" as const,
      includeDomains: [],
    };
    for (let i = 0; i < 6; i += 1) {
      const started = Date.now();
      const result = await merged.search(request, {});
      expect(result.hits.map((hit) => hit.url).sort()).toEqual([
        "https://brave.example.org/a",
        "https://tavily.example.org/b",
      ]);
      // A resting index is skipped at once, never waited on.
      expect(Date.now() - started).toBeLessThan(500);
    }
    expect(calls).toEqual({ scrapingbee: 1, serper: 1, brave: 6, tavily: 6 });
  });
});

describe("round 4: a search for more keeps its words", () => {
  it("sends 'startups to watch', 'emerging' and 'accelerator' with real categories", async () => {
    const provider = createFakeResearchProvider({ pages: [DIRECTORY] });
    const service = createPublicWebResearchService({ provider });
    await service.research(
      command({
        runId: `${RUN}-more`,
        requestedQuery: "fintech startups to watch Nigeria 2026",
        alsoQueries: ["emerging fintech startup accelerator Nigeria 2026"],
        categories: { sectors: ["fintech"], countries: ["NG"] },
      }),
    );
    const sent = provider.searches.map((s) => s.query).join(" | ");
    expect(sent).toContain("to watch");
    expect(sent).toContain("emerging");
    expect(sent).toContain("accelerator");
  });
});
