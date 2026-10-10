import { describe, expect, it } from "vitest";

import { PersonSearchResultSchema } from "@capital-q/contracts/q";

import {
  createPersonSearch,
  externalPersonIdFor,
  planPersonQueries,
} from "../src/application/person-search.js";
import type {
  PublicWebSearchHit,
  PublicWebSearchRequest,
} from "../src/contracts.js";
import {
  basicNameVariants,
  decideIdentity,
  linkedInProfileOf,
  profileFactsOf,
  rankCandidates,
  type PersonSpec,
} from "../src/domain/person-identity.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../src/ports.js";

/** Fakes only: no provider is ever called. */

const SHADI: PublicWebSearchHit = {
  url: "https://qa.linkedin.com/in/shadi-qishta-282453a",
  title:
    "Shadi Qishta - Finance Director - Midmac Contracting Company W.L.L. | LinkedIn",
  snippet:
    "View Shadi Qishta's profile on LinkedIn. Location: Qatar · 500+ connections · Experience: Midmac Contracting Company W.L.L.",
  publishedAt: null,
  relevance: 0.9,
};
const SHADI_NEWS: PublicWebSearchHit = {
  url: "https://example-news.com/midmac-appoints",
  title: "Midmac appoints Shadi Qishta as finance leader",
  snippet:
    "Midmac Contracting in Doha has appointed Shadi Qishta to lead finance and investment.",
  publishedAt: "2024-03-01",
  relevance: 0.6,
};
const OTHER_SHADI: PublicWebSearchHit = {
  url: "https://www.linkedin.com/in/shadi-qishta-91b2c4",
  title: "Shadi Qishta - Product Designer - Acme Studio | LinkedIn",
  snippet: "Location: Toronto, Canada · Experience: Acme Studio",
  publishedAt: null,
  relevance: 0.8,
};

const spec: PersonSpec = {
  name: "Shadi Qishta",
  place: "Doha Qatar",
  organization: null,
  role: null,
  variants: [],
};

function fake(
  code: "tavily" | "serpapi" | "brightdata",
  options: {
    delayMs?: number;
    hits?: PublicWebSearchHit[];
    fail?: boolean;
    hang?: boolean;
  } = {},
): PublicWebResearchProvider & { requests: PublicWebSearchRequest[] } {
  const requests: PublicWebSearchRequest[] = [];
  return {
    code,
    requests,
    search: (request, context) => {
      requests.push(request);
      return new Promise((resolve, reject) => {
        if (options.hang === true) return; // ignores its signal on purpose
        const timer = setTimeout(() => {
          if (options.fail === true) {
            reject(
              new ResearchProviderFailure({
                providerCode: code,
                failureClass: "UNAVAILABLE",
              }),
            );
          } else {
            resolve({
              hits: options.hits ?? [],
              latencyMs: options.delayMs ?? 0,
            });
          }
        }, options.delayMs ?? 0);
        context.signal?.addEventListener("abort", () => clearTimeout(timer));
      });
    },
    extract: () => Promise.resolve({ pages: [], failedUrls: [], latencyMs: 0 }),
  };
}

const command = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  name: "Shadi Qishta",
  place: "Doha Qatar",
  userText: "find Shadi Qishta, Doha, Qatar",
};

describe("person query planning", () => {
  it("plans 3-5 distinct queries including a profile-index query", () => {
    const planned = planPersonQueries({
      ...spec,
      organization: "Midmac",
      role: "finance director",
      variants: ["Shadi Kishta"],
    });
    expect(planned.length).toBeGreaterThanOrEqual(3);
    expect(planned.length).toBeLessThanOrEqual(5);
    expect(planned.some((p) => p.includeDomains.includes("linkedin.com"))).toBe(
      true,
    );
    expect(
      new Set(planned.map((p) => p.query + p.includeDomains.join())).size,
    ).toBe(planned.length);
  });
  it("offers a transliteration variant without a phrase list", () => {
    expect(basicNameVariants("Shadi Qishta")).toContain("Shadi Kishta");
  });
});

describe("identity ranking", () => {
  it("reads a LinkedIn title and snippet and keys by profile, not subdomain", () => {
    expect(linkedInProfileOf(SHADI.url)?.key).toBe(
      "linkedin.com/in/shadi-qishta-282453a",
    );
    expect(
      linkedInProfileOf("https://www.linkedin.com/in/shadi-qishta-282453a/?x=1")
        ?.key,
    ).toBe("linkedin.com/in/shadi-qishta-282453a");
    const facts = profileFactsOf(SHADI);
    expect(facts.role).toBe("Finance Director");
    expect(facts.organization).toContain("Midmac");
    expect(facts.location).toBe("Qatar");
  });

  it("is a strong match when the place agrees, with the news page attached as a second source", () => {
    const pool = [
      { provider: "tavily", hit: SHADI },
      { provider: "serpapi", hit: SHADI_NEWS },
    ];
    const decision = decideIdentity(spec, rankCandidates(spec, pool));
    expect(decision.kind).toBe("MATCHED");
    if (decision.kind !== "MATCHED") return;
    expect(decision.chosen.confidence).toBe("STRONG");
    expect(decision.chosen.hits).toHaveLength(2);
  });

  it("conflation guard: two same-name people are never merged", () => {
    const pool = [
      { provider: "tavily", hit: SHADI },
      { provider: "tavily", hit: OTHER_SHADI },
    ];
    const ranked = rankCandidates(spec, pool);
    expect(ranked).toHaveLength(2);
    const top = ranked[0];
    expect(top?.profileUrl).toContain("282453a");
    // The Toronto namesake is contradicted by the place, so the Doha one wins.
    const decision = decideIdentity(spec, ranked);
    expect(decision.kind).toBe("MATCHED");
    if (decision.kind === "MATCHED")
      expect(decision.chosen.location).toBe("Qatar");
  });

  it("asks one question when the member's words do not tell two people apart", () => {
    const nameOnly: PersonSpec = { ...spec, place: null };
    const decision = decideIdentity(
      nameOnly,
      rankCandidates(nameOnly, [
        { provider: "tavily", hit: SHADI },
        { provider: "tavily", hit: OTHER_SHADI },
      ]),
    );
    expect(decision.kind).toBe("AMBIGUOUS");
  });

  it("W4: a city match beats a shared country, so 'the one in Abuja' narrows to that person", () => {
    const ABUJA: PublicWebSearchHit = {
      url: "https://ng.linkedin.com/in/ada-obi-1a2b3c",
      title: "Ada Obi - Banker - First Bank | LinkedIn",
      snippet: "Location: Abuja, Nigeria · Experience: First Bank",
      publishedAt: null,
      relevance: 0.8,
    };
    const LAGOS: PublicWebSearchHit = {
      url: "https://ng.linkedin.com/in/ada-obi-9z8y7x",
      title: "Ada Obi - Doctor - Lagoon Clinic | LinkedIn",
      snippet: "Location: Lagos, Nigeria · Experience: Lagoon Clinic",
      publishedAt: null,
      relevance: 0.8,
    };
    const pool = [
      { provider: "tavily", hit: LAGOS },
      { provider: "tavily", hit: ABUJA },
    ];
    // A shared country alone: both agree, so they stay ambiguous.
    const country: PersonSpec = {
      name: "Ada Obi",
      place: "Nigeria",
      country: "Nigeria",
      organization: null,
      role: null,
      variants: [],
    };
    expect(decideIdentity(country, rankCandidates(country, pool)).kind).toBe(
      "AMBIGUOUS",
    );
    // City and country given: the city decides.
    const city: PersonSpec = {
      ...country,
      place: "Abuja Nigeria",
      city: "Abuja",
    };
    const ranked = rankCandidates(city, pool);
    expect(ranked[0]?.location).toContain("Abuja");
    expect(ranked.map((c) => c.placeScore)).toEqual([2, 1]);
    const decision = decideIdentity(city, ranked);
    expect(decision.kind).toBe("MATCHED");
    if (decision.kind === "MATCHED") {
      expect(decision.chosen.profileUrl).toContain("1a2b3c");
    }
  });

  it("never turns an absent location into a mismatch", () => {
    const hit = {
      ...SHADI,
      snippet: "View profile",
      url: "https://www.linkedin.com/in/shadi-qishta-282453a",
    };
    const [candidate] = rankCandidates(spec, [{ provider: "tavily", hit }]);
    expect(candidate?.placeMatch).toBe("UNKNOWN");
    expect(candidate?.confidence).toBe("PLAUSIBLE");
  });

  it("does not accept a profile whose title names someone else", () => {
    const hit = { ...OTHER_SHADI, title: "Sara Qishta - Designer | LinkedIn" };
    expect(rankCandidates(spec, [{ provider: "tavily", hit }])).toHaveLength(0);
  });

  it("derives a stable id per asker and person", () => {
    const a = externalPersonIdFor("t", "u", "linkedin.com/in/x");
    expect(a).toBe(externalPersonIdFor("t", "u", "linkedin.com/in/x"));
    expect(a).not.toBe(externalPersonIdFor("t", "u2", "linkedin.com/in/x"));
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});

describe("live-observed shapes (2026-10-10)", () => {
  const LIVE: PublicWebSearchHit = {
    url: "https://qa.linkedin.com/in/shadi-qishta-282453a",
    title:
      "Shadi Qishta\u200f - \u200fC-Suite executive with expertise in Finance - 25 years 3 months",
    snippet: "Doha, Qatar · Experience: 25 years 3 months · Education: AUB",
    publishedAt: null,
    relevance: 0.9,
  };
  it("does not read a duration as an employer, and a stated employer mismatch is not a contradiction", () => {
    const withOrg: PersonSpec = { ...spec, organization: "Midmac" };
    const [candidate] = rankCandidates(withOrg, [
      { provider: "tavily", hit: LIVE },
    ]);
    expect(candidate?.organization).toBeNull();
    expect(candidate?.confidence).not.toBe("WEAK");
    expect(candidate?.placeMatch).toBe("MATCH");
  });
  it("a name alone is never an identity: one candidate still gets a clarifying question", () => {
    const nameOnly: PersonSpec = { ...spec, place: null };
    const decision = decideIdentity(
      nameOnly,
      rankCandidates(nameOnly, [{ provider: "tavily", hit: SHADI }]),
    );
    expect(decision.kind).toBe("AMBIGUOUS");
  });
  it("matches a transliterated profile name through the shared name scorer", () => {
    const hit = {
      ...SHADI,
      title: "Shadi Kishta - Finance Director | LinkedIn",
    };
    expect(rankCandidates(spec, [{ provider: "tavily", hit }])).toHaveLength(1);
  });
});

describe("fast person search under a deadline", () => {
  it("returns an identity card from a fake index and validates against the contract", async () => {
    const search = createPersonSearch({
      providers: [
        fake("tavily", { hits: [SHADI] }),
        fake("serpapi", { hits: [SHADI, SHADI_NEWS] }),
      ],
    });
    const run = await search.search(command);
    expect(run.result.outcome).toBe("MATCHED");
    expect(PersonSearchResultSchema.safeParse(run.result).success).toBe(true);
    expect(run.result.card?.subject.profileUrl).toContain(
      "shadi-qishta-282453a",
    );
    expect(run.result.card?.actions).toEqual(["RESEARCH_FURTHER", "REHEARSE"]);
  });

  it("sends only the member's own words (an invented organisation is dropped)", async () => {
    const p = fake("tavily", { hits: [SHADI] });
    await createPersonSearch({ providers: [p] }).search({
      ...command,
      organization: "Secret Fund LP",
    });
    const sent = p.requests.map((r) => r.query).join(" | ");
    expect(sent).not.toContain("secret");
    expect(sent).toContain("shadi qishta");
  });

  it("answers within the 5 s budget when one index hangs forever and one is slow", async () => {
    const started = Date.now();
    const run = await createPersonSearch({
      providers: [
        fake("tavily", { hang: true }),
        fake("serpapi", { delayMs: 4_000, hits: [SHADI] }),
        fake("brightdata", { delayMs: 300, hits: [SHADI_NEWS] }),
      ],
    }).search({ ...command, budget: { overallMs: 1_000, perCallMs: 600 } });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1_400);
    expect(run.calls.some((c) => c.outcome === "TIMEOUT")).toBe(true);
    // Only a news mention arrived in time: a lead, never a confirmed identity.
    expect(run.result.card?.subject.confidence).not.toBe("STRONG");
  });

  it("enforces the per-call deadline and records it", async () => {
    const run = await createPersonSearch({
      providers: [fake("tavily", { delayMs: 2_000, hits: [SHADI] })],
    }).search({ ...command, budget: { overallMs: 3_000, perCallMs: 200 } });
    expect(run.calls.every((c) => c.outcome === "TIMEOUT")).toBe(true);
    expect(run.result.outcome).toBe("UNAVAILABLE");
  });

  it("cancels in-flight calls as soon as a clear winner is confirmed", async () => {
    const started = Date.now();
    const run = await createPersonSearch({
      providers: [
        fake("tavily", { delayMs: 20, hits: [SHADI] }),
        fake("serpapi", { delayMs: 30, hits: [SHADI] }),
        fake("brightdata", { hang: true }),
      ],
    }).search(command);
    expect(Date.now() - started).toBeLessThan(500);
    expect(run.result.outcome).toBe("MATCHED");
    expect(run.calls.some((c) => c.outcome === "CANCELLED")).toBe(true);
  });

  it("reports NOT_FOUND (not UNAVAILABLE) when indexes answered with nothing", async () => {
    const run = await createPersonSearch({
      providers: [fake("tavily", { hits: [] })],
    }).search(command);
    expect(run.result.outcome).toBe("NOT_FOUND");
  });

  it("reports UNAVAILABLE when every index failed", async () => {
    const run = await createPersonSearch({
      providers: [fake("tavily", { fail: true })],
    }).search(command);
    expect(run.result.outcome).toBe("UNAVAILABLE");
  });

  it("honours an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = await createPersonSearch({
      providers: [fake("tavily", { delayMs: 1_000, hits: [SHADI] })],
    }).search({ ...command, signal: controller.signal });
    expect(run.result.card).toBeNull();
  });

  it("keeps the real 5 s overall budget with every index hanging", async () => {
    const started = Date.now();
    const run = await createPersonSearch({
      providers: [
        fake("tavily", { hang: true }),
        fake("serpapi", { hang: true }),
      ],
    }).search(command);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(3_000);
    expect(elapsed).toBeLessThan(4_700);
    expect(run.result.outcome).toBe("UNAVAILABLE");
  }, 10_000);
});
