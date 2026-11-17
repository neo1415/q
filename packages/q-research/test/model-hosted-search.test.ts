import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createPublicWebResearchService,
  type ResearchEvidenceRecorder,
  type ResearchSubject,
} from "../src/index.js";
import { createFakeResearchProvider } from "../src/providers/fake.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";
import {
  createLastResortSearchProvider,
  createModelHostedSearchProvider,
  hostedHits,
  MODEL_HOSTED_SEARCH_CODE,
  type ModelHostedSearchCall,
  type ModelHostedSearchPort,
  type ModelHostedSource,
} from "../src/providers/model-hosted-search.js";

/**
 * DECISIONS 103: the model-hosted search is the LAST research fallback.
 * Fakes only; nothing here reaches a model or the network.
 */

const PRIVATE_MARKER = "CQ_PRIVATE_DO_NOT_EGRESS_55120";
const actor: ActorContext = ActorContextSchema.parse({
  userId: "44444444-4444-4444-8444-444444444444",
  tenantId: "33333333-3333-4333-8333-333333333333",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorType: "HUMAN",
});

const SOURCES: ModelHostedSource[] = [
  {
    url: "https://kibohealth.example/about",
    title: "About Kibo Health Systems",
    quotedText: "Kibo Health Systems builds inventory software for clinics.",
    pageAge: "2026-07-01",
  },
  {
    url: "https://techpress.example/kibo-seed",
    title: "Kibo raises seed",
    quotedText: "Kibo Health Systems raised a seed round.",
    pageAge: "3 days ago",
  },
  {
    url: "http://localhost/internal",
    title: "Not public",
    quotedText: "x",
    pageAge: null,
  },
];

function hostedPort(
  answer: Awaited<ReturnType<ModelHostedSearchPort>> = {
    ok: true,
    sources: SOURCES,
    latencyMs: 5,
  },
): { port: ModelHostedSearchPort; calls: ModelHostedSearchCall[] } {
  const calls: ModelHostedSearchCall[] = [];
  return {
    calls,
    port: (call) => {
      calls.push(call);
      return Promise.resolve(answer);
    },
  };
}

const context = {
  attribution: {
    tenantId: actor.tenantId,
    userId: actor.userId,
    runId: "run-1",
    correlationId: "cor_test",
  },
};
const request = {
  query: "Kibo Health Systems",
  maxResults: 6,
  freshness: "ANY" as const,
  includeDomains: [],
};

function chain(
  primaryFails: "RATE_LIMIT" | "AUTHENTICATION" | "VALIDATION" | null,
) {
  const index = createFakeResearchProvider({
    pages: [
      {
        url: "https://index.example/kibo",
        title: "Kibo on the index",
        snippet: "From the configured index.",
        text: "Kibo Health Systems, from the configured index.",
      },
    ],
    ...(primaryFails === null
      ? {}
      : {
          behaviour: {
            kind: "FAIL_SEARCH" as const,
            failureClass: primaryFails,
          },
        }),
  });
  const hosted = hostedPort();
  const fallbacks: unknown[] = [];
  const provider = createLastResortSearchProvider({
    primary: createFallbackResearchProvider({ providers: [index] }),
    lastResort: createModelHostedSearchProvider({ search: hosted.port }),
    onFallback: (event) => fallbacks.push(event),
  });
  return { provider, index, hosted, fallbacks };
}

describe("last-resort order", () => {
  it("uses the configured indexes first and never the model when they answer", async () => {
    const { provider, hosted } = chain(null);
    const result = await provider.search(request, context);
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://index.example/kibo",
    ]);
    expect(provider.code).toBe("fake");
    expect(hosted.calls).toHaveLength(0);
  });

  it("an index's empty answer is its answer: no paid fallback", async () => {
    const empty = createFakeResearchProvider({ pages: [] });
    const hosted = hostedPort();
    const provider = createLastResortSearchProvider({
      primary: empty,
      lastResort: createModelHostedSearchProvider({ search: hosted.port }),
    });
    const result = await provider.search(request, context);
    expect(result.hits).toEqual([]);
    expect(hosted.calls).toHaveLength(0);
  });

  for (const failure of ["RATE_LIMIT", "AUTHENTICATION"] as const) {
    it(`falls back to the model-hosted search when every index failed (${failure}) and labels the answer`, async () => {
      const { provider, hosted, fallbacks } = chain(failure);
      const result = await provider.search(request, context);
      expect(hosted.calls).toHaveLength(1);
      expect(provider.code).toBe(MODEL_HOSTED_SEARCH_CODE);
      expect(result.hits.map((hit) => hit.url)).toEqual([
        "https://kibohealth.example/about",
        "https://techpress.example/kibo-seed",
      ]);
      expect(fallbacks).toEqual([
        {
          provider: MODEL_HOSTED_SEARCH_CODE,
          outcome: "FOUND",
          primaryFailure: failure,
          failureClass: null,
        },
      ]);
    });
  }

  it("does not fall back on a request the indexes refused as invalid", async () => {
    const { provider, hosted } = chain("VALIDATION");
    await expect(provider.search(request, context)).rejects.toMatchObject({
      failureClass: "VALIDATION",
    });
    expect(hosted.calls).toHaveLength(0);
  });

  it("reports the indexes' own failure when the model-hosted search is unavailable too (cap reached)", async () => {
    const index = createFakeResearchProvider({
      pages: [],
      behaviour: { kind: "FAIL_SEARCH", failureClass: "AUTHENTICATION" },
    });
    const hosted = hostedPort({ ok: false, failureClass: "RATE_LIMIT" });
    const provider = createLastResortSearchProvider({
      primary: index,
      lastResort: createModelHostedSearchProvider({ search: hosted.port }),
    });
    await expect(provider.search(request, context)).rejects.toMatchObject({
      failureClass: "AUTHENTICATION",
      providerCode: "fake",
    });
    expect(hosted.calls).toHaveLength(1);
    expect(provider.code).toBe("fake");
  });

  it("reads pages with the indexes' readers only", async () => {
    const { provider, index, hosted } = chain("RATE_LIMIT");
    await provider
      .extract({ urls: ["https://index.example/kibo"] }, context)
      .catch(() => undefined);
    expect(index.extracts).toHaveLength(1);
    expect(hosted.calls).toHaveLength(0);
  });
});

describe("model-hosted search bounds", () => {
  it("makes at most one hosted search per research turn, even side by side", async () => {
    const hosted = hostedPort();
    const provider = createModelHostedSearchProvider({ search: hosted.port });
    const settled = await Promise.allSettled([
      provider.search(request, context),
      provider.search({ ...request, query: "Kibo Kenya" }, context),
    ]);
    expect(settled.map((s) => s.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(hosted.calls).toHaveLength(1);
    // A new turn may search again.
    await provider.search(request, {
      attribution: { ...context.attribution, runId: "run-2" },
    });
    expect(hosted.calls).toHaveLength(2);
  });

  it("does not search without a turn to bill (no attribution)", async () => {
    const hosted = hostedPort();
    const provider = createModelHostedSearchProvider({ search: hosted.port });
    await expect(provider.search(request, {})).rejects.toMatchObject({
      failureClass: "UNAVAILABLE",
      providerCode: MODEL_HOSTED_SEARCH_CODE,
    });
    expect(hosted.calls).toHaveLength(0);
  });

  it("normalises sources into safe, bounded hits", () => {
    const hits = hostedHits(
      [
        ...SOURCES,
        {
          ...SOURCES[0],
          url: "https://kibohealth.example/about",
        } as ModelHostedSource,
        {
          url: "https://long.example/",
          title: "<b>Long</b>",
          quotedText: "y".repeat(2_000),
          pageAge: null,
        },
      ],
      6,
    );
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://kibohealth.example/about",
      "https://techpress.example/kibo-seed",
      "https://long.example/",
    ]);
    expect(hits[0]).toMatchObject({
      title: "About Kibo Health Systems",
      snippet: "Kibo Health Systems builds inventory software for clinics.",
      publishedAt: "2026-07-01",
    });
    // A relative age is not a date.
    expect(hits[1]?.publishedAt).toBeNull();
    expect(hits[2]?.snippet.length).toBeLessThanOrEqual(600);
  });
});

describe("what reaches the model-hosted search", () => {
  function recorder(): {
    port: ResearchEvidenceRecorder;
    providers: unknown[];
  } {
    const providers: unknown[] = [];
    let n = 0;
    return {
      providers,
      port: {
        listSources: () => Promise.resolve([]),
        registerSource: (_actor, input) => {
          providers.push(input.provider);
          n += 1;
          return Promise.resolve({ id: `src-${String(n)}` });
        },
        listItems: () => Promise.resolve([]),
        createItem: () => {
          n += 1;
          return Promise.resolve({ id: `item-${String(n)}` });
        },
      },
    };
  }

  const ownedCompany: ResearchSubject = {
    kind: "COMPANY",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Kibo Health Systems",
    websiteUrl: "https://www.kibohealth.example",
    headquartersCountry: "NG",
    identityAuthorised: true,
    persistAsEvidence: true,
  };

  it("only the composed public query leaves; private facts never do; sources are labelled model_hosted_web_search", async () => {
    const index = createFakeResearchProvider({
      pages: [
        {
          url: "https://kibohealth.example/about",
          title: "About Kibo Health Systems",
          snippet: "s",
          text: "Kibo Health Systems builds inventory software for clinics.",
        },
        {
          url: "https://techpress.example/kibo-seed",
          title: "Kibo raises seed",
          snippet: "s",
          text: "Kibo Health Systems raised a seed round.",
        },
      ],
      behaviour: { kind: "FAIL_SEARCH", failureClass: "AUTHENTICATION" },
    });
    const hosted = hostedPort();
    const evidence = recorder();
    const service = createPublicWebResearchService({
      provider: createLastResortSearchProvider({
        primary: index,
        lastResort: createModelHostedSearchProvider({ search: hosted.port }),
      }),
      evidence: evidence.port,
      clock: () => new Date("2026-11-17T12:00:00.000Z"),
    });
    const outcome = await service.research({
      actor,
      runId: "run-private",
      correlationId: "cor_research_private",
      requestedQuery: "Kibo Health Systems Kenya operations",
      // Private facts live in the conversation, never in the composed query.
      userText: `Research my company; our runway is 7 months, burn 120k a month ${PRIVATE_MARKER}`,
      earlierUserText: [`Our cash is 840k ${PRIVATE_MARKER}`],
      subject: ownedCompany,
      extractCount: 2,
    });
    expect(outcome.status).toBe("OK");
    // Every request the indexes AND the hosted search received.
    const egressed = JSON.stringify({
      index: index.egressed(),
      hosted: hosted.calls.map((call) => ({
        query: call.query,
        includeDomains: call.includeDomains,
      })),
    });
    expect(egressed.toLowerCase()).not.toContain(PRIVATE_MARKER.toLowerCase());
    expect(egressed).not.toMatch(/runway|burn|120k|840k/i);
    // The hosted search is asked only what an index would have been asked.
    const composed = index.searches.map((search) => search.query);
    for (const call of hosted.calls) expect(composed).toContain(call.query);
    // One hosted search for the whole turn, attributed by identifiers only.
    expect(hosted.calls).toHaveLength(1);
    expect(hosted.calls[0]?.attribution).toEqual({
      tenantId: actor.tenantId,
      userId: actor.userId,
      runId: "run-private",
      correlationId: "cor_research_private",
    });
    // Provenance: the sources the hosted search found are labelled as such.
    if (outcome.status === "OK") {
      expect(outcome.sources.length).toBeGreaterThan(0);
    }
    expect(evidence.providers.length).toBeGreaterThan(0);
    expect(new Set(evidence.providers)).toEqual(
      new Set([MODEL_HOSTED_SEARCH_CODE]),
    );
  });
});
