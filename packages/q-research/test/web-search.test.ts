import { describe, expect, it } from "vitest";

import { createPublicWebResearchService } from "../src/application/research-service.js";
import type {
  PublicWebSearchHit,
  PublicWebSearchRequest,
} from "../src/contracts.js";
import { searchPhrase } from "../src/domain/egress.js";
import { canonicalUrlKey } from "../src/domain/url-safety.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../src/ports.js";

/**
 * Open-web search (founder report 2026-10-06: "Q still says it can't
 * search the internet"). Fakes only: no provider is ever called.
 */

const actor = {
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  actorType: "HUMAN",
} as unknown as Parameters<
  ReturnType<typeof createPublicWebResearchService>["research"]
>[0]["actor"];

const NOW = new Date("2026-10-06T12:00:00.000Z");

type Page = {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly publishedAt?: string;
};

/**
 * A scripted index: a query gets the pages whose `when` words it contains.
 * Records every request, so a test can assert what left Capital Q.
 */
function scriptedIndex(
  code: "tavily" | "serpapi",
  script: readonly { readonly when: string; readonly pages: readonly Page[] }[],
  options: { readonly fail?: boolean; readonly readsPages?: boolean } = {},
) {
  const searches: PublicWebSearchRequest[] = [];
  const reads: string[][] = [];
  const all = new Map(
    script.flatMap((entry) => entry.pages.map((p) => [p.url, p] as const)),
  );
  const provider: PublicWebResearchProvider = {
    code,
    search: (request) => {
      searches.push(request);
      if (options.fail === true) {
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: code,
            failureClass: "RATE_LIMIT",
          }),
        );
      }
      const hits: PublicWebSearchHit[] = script
        .filter((entry) =>
          entry.when
            .split(" ")
            .every((word) => request.query.toLowerCase().includes(word)),
        )
        .flatMap((entry) => entry.pages)
        .slice(0, request.maxResults)
        .map((page, index) => ({
          url: page.url,
          title: page.title,
          snippet: page.text.slice(0, 200),
          publishedAt: page.publishedAt ?? null,
          relevance: Math.max(0, 0.9 - index * 0.1),
        }));
      return Promise.resolve({ hits, latencyMs: 1 });
    },
    extract: (request) => {
      reads.push([...request.urls]);
      if (options.readsPages === false) {
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: code,
            failureClass: "UNAVAILABLE",
          }),
        );
      }
      const pages = request.urls.flatMap((url) => {
        const page =
          all.get(url) ??
          [...all.values()].find(
            (p) => canonicalUrlKey(p.url) === canonicalUrlKey(url),
          );
        return page === undefined
          ? []
          : [{ url, title: page.title, text: page.text }];
      });
      return Promise.resolve({
        pages,
        failedUrls: request.urls.filter(
          (url) => !pages.some((p) => p.url === url),
        ),
        latencyMs: 1,
      });
    },
  };
  return {
    provider,
    searches,
    reads,
    egressed: () => JSON.stringify({ searches, reads }),
  };
}

const YC_PAGES: readonly Page[] = [
  {
    url: "https://www.ycombinator.com/companies?industry=fintech&batch=2026",
    title: "YC fintech companies, 2026 batches",
    text: "Y Combinator fintech companies in the 2026 batches include Ledgerline (payments, Nigeria), Paystream (payroll, Kenya) and Duna (compliance).",
    publishedAt: "2026-09-20",
  },
  {
    url: "https://techcabal.com/2026/09/yc-african-fintechs/",
    title: "Three African fintechs in YC's latest batch",
    text: "Ledgerline and Paystream joined Y Combinator this year; both build payments infrastructure for African SMEs.",
    publishedAt: "2026-09-25",
  },
];

describe("open-web search: an open question", () => {
  it("plans several phrasings, asks both indexes at once, merges by canonical URL and reads the best pages, each one cited", async () => {
    const tavily = scriptedIndex("tavily", [
      { when: "fintech", pages: YC_PAGES },
    ]);
    // The same page under a different spelling, plus one of its own.
    const serp = scriptedIndex(
      "serpapi",
      [
        {
          when: "fintech",
          pages: [
            {
              ...(YC_PAGES[1] as Page),
              url: "http://techcabal.com/2026/09/yc-african-fintechs?utm_source=x",
            },
            {
              url: "https://www.pinterest.com/pin/yc-fintech",
              title: "YC fintech pins",
              text: "fintech pins",
            },
          ],
        },
      ],
      { readsPages: false },
    );
    const provider = createFallbackResearchProvider({
      providers: [tavily.provider, serp.provider],
      parallelSearch: true,
    });
    const service = createPublicWebResearchService({
      provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-yc",
      correlationId: "cor_test",
      requestedQuery: "YC fintech companies 2026",
      alsoQueries: ["Y Combinator fintech batch 2026"],
      userText:
        "Can you find me three YC-backed fintech companies from the 2026 batch? Y Combinator only.",
      subject: null,
    });
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") return;
    // Several distinct queries, all from the person's own words.
    expect(outcome.queries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(outcome.queries).size).toBe(outcome.queries.length);
    // Both indexes saw every planned query, in parallel.
    expect(tavily.searches.length).toBe(serp.searches.length);
    expect(tavily.searches.length).toBeGreaterThanOrEqual(3);
    // One entry per page, however each index spelled it.
    const keys = outcome.sources.map((s) => canonicalUrlKey(s.url));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("techcabal.com/2026/09/yc-african-fintechs");
    // Primary and accountable sources lead; a pin board trails.
    expect(outcome.sources[0]?.domain).not.toBe("pinterest.com");
    expect(outcome.sources.length).toBeLessThanOrEqual(6);
    // Read through the index that reads pages; every source citable.
    expect(tavily.reads).toHaveLength(1);
    for (const source of outcome.sources) {
      expect(source.url).toMatch(/^https?:\/\//);
      expect(source.retrievedAt).toBe(NOW.toISOString());
    }
    expect(outcome.sources.some((s) => s.excerpt.includes("Ledgerline"))).toBe(
      true,
    );
    expect(outcome.entityResolution.status).toBe("NOT_APPLICABLE");
  });

  it("still answers when one index is down; fails only when every one is", async () => {
    const tavily = scriptedIndex("tavily", [
      { when: "fintech", pages: YC_PAGES },
    ]);
    const down = scriptedIndex("serpapi", [], { fail: true });
    const service = createPublicWebResearchService({
      provider: createFallbackResearchProvider({
        providers: [down.provider, tavily.provider],
        parallelSearch: true,
      }),
      clock: () => NOW,
    });
    const ok = await service.research({
      actor,
      runId: "run-down",
      correlationId: "cor_test",
      requestedQuery: "YC fintech",
      userText: "YC fintech companies",
      subject: null,
    });
    expect(ok.status).toBe("OK");

    const both = createPublicWebResearchService({
      provider: createFallbackResearchProvider({
        providers: [
          scriptedIndex("serpapi", [], { fail: true }).provider,
          scriptedIndex("tavily", [], { fail: true }).provider,
        ],
        parallelSearch: true,
      }),
    });
    const failed = await both.research({
      actor,
      runId: "run-down-2",
      correlationId: "cor_test",
      requestedQuery: "YC fintech",
      userText: "YC fintech companies",
      subject: null,
    });
    expect(failed.status).toBe("PROVIDER_UNAVAILABLE");
  });

  it("turns the person's sentence into a search phrase without the asking", () => {
    expect(
      searchPhrase("Hey Q, can you please look up YC fintech startups?"),
    ).toBe("yc fintech startups");
    expect(searchPhrase("look it up")).toBe("");
    expect(searchPhrase("search for revenue of $2.4m")).toBe("for revenue of");
  });
});

describe("open-web search: a company or person by name, no website", () => {
  const MAI_SOLI_PAGES: readonly Page[] = [
    {
      url: "https://maisolifoundation.org/about",
      title: "About Mai Soli Foundation",
      text: "Mai Soli Foundation supports girls' education in Lagos, Nigeria.",
    },
    {
      url: "https://www.linkedin.com/company/mai-soli",
      title: "Mai Soli Foundation | LinkedIn",
      text: "Mai Soli Foundation, a Nigerian non-profit.",
    },
  ];

  it("searches the name the person gave and resolves it from the pages", async () => {
    const index = scriptedIndex("tavily", [
      { when: "mai soli", pages: MAI_SOLI_PAGES },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-mai",
      correlationId: "cor_test",
      requestedQuery: "Mai Soli Foundation",
      entityName: "Mai Soli Foundation",
      userText: "Can you look up Mai Soli Foundation online?",
      subject: null,
    });
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") return;
    expect(index.searches.length).toBeGreaterThan(0);
    expect(outcome.entityResolution.status).toBe("RESOLVED");
    expect(outcome.sources.every((s) => s.subjectMatch === "MATCH")).toBe(true);
  });

  it("looks up a name said in an earlier message ('look her up')", async () => {
    const index = scriptedIndex("tavily", [
      { when: "aria mustary", pages: MAI_SOLI_PAGES },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-earlier",
      correlationId: "cor_test",
      requestedQuery: "Aria Mustary",
      entityName: "Aria Mustary",
      userText: "Can you look her up?",
      earlierUserText: ["My co-founder is Aria Mustary."],
      subject: null,
    });
    expect(outcome.status).toBe("OK");
    expect(index.searches.map((s) => s.query)).toContain("aria mustary");
  });

  it("an ambiguous name is searched first, then reported as ambiguous with the candidates, never attributed", async () => {
    const index = scriptedIndex("tavily", [
      {
        when: "zenith",
        pages: [
          {
            url: "https://zenithpay.com/",
            title: "Zenith Pay",
            text: "Zenith Pay is a payments company in Nairobi, Kenya.",
          },
          {
            url: "https://zenithpay.io/",
            title: "ZenithPay",
            text: "ZenithPay builds payroll software in Cape Town, South Africa.",
          },
        ],
      },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-zenith",
      correlationId: "cor_test",
      requestedQuery: "Zenith Pay",
      entityName: "Zenith Pay",
      userText: "What do you know about Zenith Pay?",
      subject: null,
    });
    expect(index.searches.length).toBeGreaterThan(0);
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") return;
    expect(outcome.entityResolution.status).toBe("AMBIGUOUS");
    expect(outcome.entityResolution.candidates).toEqual(
      expect.arrayContaining(["zenithpay.com", "zenithpay.io"]),
    );
  });

  it("a name no page mentions is NOT_FOUND, after searching", async () => {
    const index = scriptedIndex("tavily", [
      { when: "qwertyzx", pages: [YC_PAGES[0] as Page] },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-none",
      correlationId: "cor_test",
      requestedQuery: "Qwertyzx Labs",
      entityName: "Qwertyzx Labs",
      userText: "Find Qwertyzx Labs",
      subject: null,
    });
    expect(index.searches.length).toBeGreaterThan(0);
    expect(outcome.status === "OK" && outcome.entityResolution.status).toBe(
      "NOT_FOUND",
    );
  });

  it("searches the founder's own private company by name and country, and resolves it", async () => {
    const index = scriptedIndex("tavily", [
      { when: "mai soli", pages: MAI_SOLI_PAGES },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-own",
      correlationId: "cor_test",
      requestedQuery: "Mai Soli Foundation",
      userText: "Can you look us up online?",
      aboutThemselves: true,
      subject: {
        kind: "COMPANY",
        companyId: "c0000000-0000-4000-8000-000000000001",
        name: "Mai Soli Foundation",
        websiteUrl: null,
        headquartersCountry: "NG",
        identityAuthorised: true,
        persistAsEvidence: false,
      },
    });
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") return;
    expect(index.searches.map((s) => s.query)).toContain(
      "mai soli foundation nigeria",
    );
    expect(outcome.entityResolution.status).toBe("RESOLVED");
  });
});

describe("open-web search: the firewall", () => {
  it("never sends another party's private fields, whatever the model proposes in any phrasing or name", async () => {
    const PRIVATE = [
      "CQ_PRIVATE_OTHER_CO_77",
      "Shoprite",
      "1.8m",
      "burn",
      "c0000000-0000-4000-8000-0000000000bb",
    ];
    const index = scriptedIndex("tavily", [
      { when: "logistics", pages: YC_PAGES },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    const outcome = await service.research({
      actor,
      runId: "run-fw",
      correlationId: "cor_test",
      requestedQuery: "logistics startups CQ_PRIVATE_OTHER_CO_77 Shoprite",
      alsoQueries: [
        "logistics 1.8m burn",
        "c0000000-0000-4000-8000-0000000000bb logistics",
        "CQ_PRIVATE_OTHER_CO_77",
      ],
      entityName: "Shoprite",
      userText: "Which logistics startups raised money in Lagos this year?",
      subject: null,
    });
    expect(outcome.status).toBe("OK");
    const sent = index.egressed().toLowerCase();
    for (const value of PRIVATE) {
      expect(sent).not.toContain(value.toLowerCase());
    }
    // A name the person never said decides nothing about the pages.
    if (outcome.status === "OK") {
      expect(outcome.entityResolution.status).toBe("NOT_APPLICABLE");
    }
  });

  it("an investor's own organisation never leads, nor is resolved as, a search about someone else", async () => {
    const index = scriptedIndex("tavily", [
      { when: "kobo360", pages: YC_PAGES },
    ]);
    const service = createPublicWebResearchService({
      provider: index.provider,
      clock: () => NOW,
    });
    await service.research({
      actor,
      runId: "run-inv",
      correlationId: "cor_test",
      requestedQuery: "Kobo360 funding",
      userText: "What has Kobo360 raised?",
      subject: {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: "b0000000-0000-4000-8000-000000000001",
        name: "Meridian Ventures",
        identityAuthorised: true,
      },
    });
    expect(index.egressed().toLowerCase()).not.toContain("meridian");
  });
});
