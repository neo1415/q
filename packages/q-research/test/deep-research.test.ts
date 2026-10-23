import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";
import { CorrelationIdSchema } from "@capital-q/contracts";

import {
  admitFacts,
  composeEgressQuery,
  createDeepResearch,
  createPublicWebResearchService,
  namesShown,
  numbersIn,
  publicTermsOf,
  type PublicWebSearchRequest,
} from "../src/index.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../src/ports.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";

/**
 * Deep research (owner 2026-10-23): the Maji Loop growth-plan request
 * researched as planned questions, side by side, over providers that fail
 * over; facts admitted only when their numbers are on their page.
 */

const actor: ActorContext = ActorContextSchema.parse({
  userId: "44444444-4444-4444-8444-444444444444",
  tenantId: "33333333-3333-4333-8333-333333333333",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorType: "HUMAN",
});
const correlationId = CorrelationIdSchema.parse(
  "cor_66666666-6666-4666-8666-666666666666",
);
const PRIVATE_MARKER = "CQ_PRIVATE_DO_NOT_EGRESS_5512";

const REQUEST =
  "I want a full growth plan for Maji Loop for the next 12 months. Do proper market research on water access and water kiosks in Kenya, size the market, look at competitors and alternatives, tell me what you think we should do and in what order, and put it in a document I can share with my team.";

/** Pages by topic; a search finds the pages whose topic words it names. */
const PAGES = [
  {
    url: "https://stats.example/kenya-water-access",
    title: "Kenya household water access 2024",
    topic: ["access", "households", "statistics"],
    text: "In 2024 about 62% of Kenyan households had access to basic drinking water; 4.1 million urban households rely on kiosks or vendors.",
  },
  {
    url: "https://report.example/water-kiosk-market",
    title: "Water kiosks in Kenya: market size",
    topic: ["kiosks", "size", "market"],
    text: "The Kenyan water vending market was worth KES 18 billion in 2023, with around 12,000 registered water kiosks.",
  },
  {
    url: "https://news.example/majik-water",
    title: "Majik Water expands water ATMs in Nairobi",
    topic: ["competitors", "atm"],
    text: "Majik Water and Grundfos Lifelink operate water ATMs selling 20 litres for KES 5 in Nairobi settlements.",
  },
  {
    url: "https://wasreb.example/regulation",
    title: "WASREB guidelines for water kiosks",
    topic: ["regulation", "wasreb"],
    text: "WASREB requires kiosk operators to be licensed by the local water service provider.",
  },
];

function topicalProvider(
  code: PublicWebResearchProvider["code"],
  seen: PublicWebSearchRequest[],
): PublicWebResearchProvider {
  return {
    code,
    search: (request) => {
      seen.push(request);
      const words = request.query.toLowerCase().split(/\s+/u);
      const hits = PAGES.filter((page) =>
        page.topic.some((topic) => words.includes(topic)),
      ).map((page) => ({
        url: page.url,
        title: page.title,
        snippet: page.text.slice(0, 120),
        publishedAt: "2024-06-01",
        relevance: 0.8,
      }));
      return Promise.resolve({ hits, latencyMs: 1 });
    },
    extract: (request) =>
      Promise.resolve({
        pages: request.urls.flatMap((url) => {
          const page = PAGES.find((one) => one.url === url);
          return page === undefined
            ? []
            : [{ url, title: page.title, text: page.text }];
        }),
        failedUrls: [],
        latencyMs: 1,
      }),
  };
}

function rateLimited(): PublicWebResearchProvider {
  const fail = () =>
    Promise.reject(
      new ResearchProviderFailure({
        providerCode: "tavily",
        failureClass: "RATE_LIMIT",
        status: 432,
      }),
    );
  return { code: "tavily", search: fail, extract: fail };
}

describe("egress for deep research", () => {
  it("lets research vocabulary and years travel only when asked, never figures", () => {
    const base = {
      requestedQuery: "Kenya water kiosks regulation statistics 2024 KES 4.5m",
      userText: REQUEST,
      publicIdentity: [],
    };
    const plain = composeEgressQuery(base);
    expect(plain.ok && plain.query).toBe("kenya water kiosks");
    const deep = composeEgressQuery({ ...base, researchVocabulary: true });
    expect(deep.ok && deep.query).toBe(
      "kenya water kiosks regulation statistics 2024",
    );
  });

  it("lets a later query name what public pages named, and nothing private", () => {
    const query = composeEgressQuery({
      requestedQuery: `Majik Water pricing Nairobi ${PRIVATE_MARKER}`,
      userText: REQUEST,
      publicIdentity: [],
      researchVocabulary: true,
      publicTerms: [
        "Majik Water and Grundfos Lifelink operate water ATMs in Nairobi",
      ],
    });
    expect(query.ok && query.query).toBe("majik water pricing nairobi");
    expect(JSON.stringify(query)).not.toContain(PRIVATE_MARKER.toLowerCase());
  });

  // Both egress widenings together (2026-10-23): a deep-research query about
  // the investor they pointed at ("the top one", after Q's list) may carry
  // that shown name, research vocabulary and what public pages named --
  // and still nothing else Q said, nor anything private.
  it("a deep-research run about someone they pointed at carries the shown name, and nothing else of Q's", () => {
    const query = composeEgressQuery({
      requestedQuery: `Savanna Seed Partners Grundfos regulation statistics Harbourline ${PRIVATE_MARKER}`,
      userText: "Why might the top one pass on us?",
      publicIdentity: [],
      shownNames: namesShown(
        ["Savanna Seed Partners"],
        [
          "Here are the investors you're talking to: 1. Savanna Seed Partners, 2. Harbourline Capital.",
        ],
      ),
      researchVocabulary: true,
      publicTerms: ["Savanna Seed Partners co-invested with Grundfos"],
    });
    expect(query.ok && query.query).toBe(
      "savanna seed partners grundfos regulation statistics",
    );
    // Harbourline is only in Q's words, never shown as whom they meant.
    expect(JSON.stringify(query)).not.toMatch(/harbourline/iu);
    expect(JSON.stringify(query)).not.toContain(PRIVATE_MARKER.toLowerCase());
  });

  it("never sends vocabulary alone: a query must still be about something", () => {
    const query = composeEgressQuery({
      requestedQuery: "market size statistics",
      userText: "hello",
      publicIdentity: [],
      researchVocabulary: true,
    });
    expect(query.ok).toBe(false);
  });
});

describe("planned questions, side by side, with failover", () => {
  it("runs every question over the next index when the first is rate-limited, and keeps each page once", async () => {
    const seen: PublicWebSearchRequest[] = [];
    const provider = createFallbackResearchProvider({
      providers: [rateLimited(), topicalProvider("brave", seen)],
    });
    const service = createPublicWebResearchService({ provider });
    let inFlight = 0;
    let most = 0;
    const deep = createDeepResearch({
      service: {
        research: async (command) => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          try {
            return await service.research(command);
          } finally {
            inFlight -= 1;
          }
        },
      },
    });
    const result = await deep.run({
      actor,
      runId: "55555555-5555-4555-8555-555555555555",
      correlationId,
      request: REQUEST,
      questions: [
        { lane: "MARKET_SIZE", query: "Kenya water kiosks market size" },
        { lane: "DEMAND", query: "Kenya households water access statistics" },
        { lane: "COMPETITORS", query: "Kenya water kiosk competitors" },
        { lane: "REGULATION", query: "Kenya water kiosk regulation" },
        // Shares a page with MARKET_SIZE: kept once, with both lanes.
        { lane: "KIOSKS", query: "water kiosks Kenya" },
      ],
      deadlineAt: Date.now() + 60_000,
      concurrency: 3,
    });
    expect(result.lanes.map((lane) => lane.status)).toEqual([
      "OK",
      "OK",
      "OK",
      "OK",
      "OK",
    ]);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(3);
    const urls = result.sources.map((source) => source.url);
    expect(new Set(urls).size).toBe(urls.length);
    const kiosk = result.sources.find((source) =>
      source.url.includes("water-kiosk-market"),
    );
    expect(kiosk?.lanes).toEqual(
      expect.arrayContaining(["MARKET_SIZE", "KIOSKS"]),
    );
    expect(kiosk?.extracted).toBe(true);
    // Focused: no question searched the person's whole sentence.
    expect(seen.every((one) => one.query.split(" ").length <= 9)).toBe(true);
  });

  it("starts no question after the deadline", async () => {
    const deep = createDeepResearch({
      service: {
        research: () => Promise.reject(new Error("must not be called")),
      },
      clock: () => 1_000,
    });
    const result = await deep.run({
      actor,
      runId: "55555555-5555-4555-8555-555555555556",
      correlationId,
      request: REQUEST,
      questions: [{ lane: "MARKET_SIZE", query: "Kenya water kiosks" }],
      deadlineAt: 999,
    });
    expect(result.lanes[0]?.status).toBe("SKIPPED_DEADLINE");
    expect(result.sources).toEqual([]);
  });

  it("a question whose search fails costs only itself", async () => {
    let calls = 0;
    const deep = createDeepResearch({
      service: {
        research: (command) => {
          calls += 1;
          if (command.requestedQuery.includes("regulation"))
            return Promise.reject(new Error("boom"));
          return Promise.resolve({
            status: "OK" as const,
            query: command.requestedQuery,
            queries: [command.requestedQuery],
            queryMinimised: false,
            entityResolution: {
              status: "NOT_APPLICABLE",
            } as never,
            sources: [],
            comparison: [],
            budget: {
              searchCalls: 1,
              resultsConsidered: 0,
              extractCalls: 0,
              sourcesExtracted: 0,
              sourcesRetained: 0,
            },
          });
        },
      },
    });
    const result = await deep.run({
      actor,
      runId: "55555555-5555-4555-8555-555555555557",
      correlationId,
      request: REQUEST,
      questions: [
        { lane: "REGULATION", query: "Kenya water kiosk regulation" },
        { lane: "MARKET_SIZE", query: "Kenya water kiosks market" },
      ],
      deadlineAt: Date.now() + 10_000,
    });
    expect(calls).toBe(2);
    expect(result.lanes.map((lane) => lane.status)).toEqual(["FAILED", "OK"]);
  });
});

describe("the dossier's admission rules", () => {
  const sources = [
    {
      index: 1,
      url: "https://report.example/water-kiosk-market",
      domain: "report.example",
      title: "Water kiosks in Kenya",
      publishedAt: "2024-06-01",
      excerpt:
        "The Kenyan water vending market was worth KES 18 billion in 2023, with around 12,000 registered water kiosks.",
    },
    {
      index: 2,
      url: "https://wasreb.example/regulation",
      domain: "wasreb.example",
      title: "WASREB",
      publishedAt: null,
      excerpt: "WASREB requires kiosk operators to be licensed.",
    },
  ];

  it("refuses a figure its page does not carry, and a source that does not exist", () => {
    const { admitted, refused } = admitFacts(
      [
        {
          statement:
            "Kenya's water vending market was worth KES 18 billion in 2023.",
          figure: "KES 18 billion",
          asOf: "2023",
          source: 1,
          lane: "MARKET_SIZE",
          kind: "FIGURE",
        },
        {
          statement: "Kenya has 15,000 water kiosks.",
          figure: "15,000",
          asOf: null,
          source: 1,
          lane: "MARKET_SIZE",
          kind: "FIGURE",
        },
        {
          statement: "Kiosk operators must be licensed.",
          figure: null,
          asOf: null,
          source: 9,
          lane: "REGULATION",
          kind: "REGULATION",
        },
      ],
      sources,
    );
    expect(admitted.map((fact) => fact.statement)).toEqual([
      "Kenya's water vending market was worth KES 18 billion in 2023.",
    ]);
    expect(refused.map((one) => one.reason)).toEqual([
      "FIGURE_NOT_IN_SOURCE",
      "UNKNOWN_SOURCE",
    ]);
    expect(admitted[0]?.id).toBe("F1");
    expect(admitted[0]?.domain).toBe("report.example");
  });

  it("deduplicates and gives every line of enquiry a turn before any gets a second", () => {
    const fact = (statement: string, lane: string, source: number) => ({
      statement,
      figure: null,
      asOf: null,
      source,
      lane,
      kind: "FACT" as const,
    });
    const { admitted } = admitFacts(
      [
        fact("There are around 12,000 registered kiosks.", "MARKET", 1),
        fact("There are around 12,000 registered kiosks.", "MARKET", 1),
        fact("The market was worth KES 18 billion.", "MARKET", 1),
        fact("Operators must be licensed by WASREB.", "REGULATION", 2),
      ],
      sources,
    );
    expect(admitted.map((one) => one.lane)).toEqual([
      "MARKET",
      "REGULATION",
      "MARKET",
    ]);
  });

  it("reads numbers the way pages write them", () => {
    expect(numbersIn("KES 1,200,000 and 4.5% in 2023")).toEqual([
      "1200000",
      "4.5",
      "2023",
    ]);
  });

  it("allows only public page words for the next round", () => {
    const terms = publicTermsOf([
      {
        index: 1,
        url: "https://news.example/majik-water",
        domain: "news.example",
        title: "Majik Water expands",
        publishedAt: null,
        retrievedAt: "2026-10-23T00:00:00.000Z",
        excerpt: "Majik Water operates water ATMs.",
        extracted: true,
        instructionRisk: false,
        lanes: ["COMPETITORS"],
      },
    ]);
    expect(terms).toEqual([
      "Majik Water expands",
      "Majik Water operates water ATMs.",
    ]);
  });
});
