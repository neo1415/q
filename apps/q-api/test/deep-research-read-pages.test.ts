import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Q_SITUATION_VERSION,
  type QSituationDossier,
} from "@capital-q/contracts";
import {
  createPublicWebResearchService,
  ResearchProviderFailure,
  type DeepResearchSource,
  type PublicWebResearchProvider,
} from "@capital-q/q-research";
import { ActorContextSchema } from "@capital-q/security";

import {
  FIRST_ROUND_GAPS,
  leadsText,
  pagesFor,
  withMarketPlace,
  workforceDeepResearch,
} from "../src/composition/workforce/deep-research.js";
import type {
  ResearchBriefOutput,
  ResearchFactsInput,
  WorkforceModels,
} from "../src/composition/workforce/models.js";

/**
 * Live case A (2026-10-29), offline: facts came from the search snippets
 * of regulator pages whose reads timed out, and two queries lost their
 * place behind an initials expansion ("cbn licensed payment operators").
 * Code now admits facts only from pages actually read, re-reads the
 * market's official pages once on their own, and puts the market's place
 * in every outgoing query. Fake models and provider; no live call.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

function source(
  overrides: Partial<DeepResearchSource> & { readonly index: number },
): DeepResearchSource {
  return {
    url: `https://example.test/${String(overrides.index)}`,
    domain: "example.test",
    title: "A page",
    publishedAt: null,
    retrievedAt: "2026-10-29T09:00:00.000Z",
    excerpt: "text",
    extracted: true,
    instructionRisk: false,
    lanes: ["MARKET"],
    ...overrides,
  };
}

describe("facts come only from pages actually read", () => {
  it("pagesFor keeps read pages; an unread page's snippet is a lead with no source number", () => {
    const read = source({ index: 1 });
    const unread = source({
      index: 2,
      extracted: false,
      excerpt: "Snippet: volumes rose 47% in 2025.",
      domain: "cbn.gov.ng",
    });
    expect(pagesFor("MARKET", [read, unread])).toEqual([read]);
    const leads = leadsText("MARKET", [read, unread]);
    expect(leads).toContain("NOT READ");
    expect(leads).toContain("cbn.gov.ng");
    expect(leads).not.toMatch(/\bS2\b/u);
    expect(leadsText("MARKET", [read])).toBe("");
  });
});

describe("every query carries the market's place", () => {
  it("appends the first market country when a query names none", () => {
    expect(withMarketPlace("cbn licensed payment operators 2025", ["NG"])).toBe(
      "cbn licensed payment operators 2025 Nigeria",
    );
    expect(withMarketPlace("nigeria b2b payments", ["NG"])).toBe(
      "nigeria b2b payments",
    );
    // A city of the market's country is a place of it.
    expect(withMarketPlace("lagos fintech licensing", ["NG"])).toBe(
      "lagos fintech licensing",
    );
    // No market place: a global question stays global.
    expect(withMarketPlace("b2b payments market size", [])).toBe(
      "b2b payments market size",
    );
  });
});

const DOSSIER: QSituationDossier = {
  version: Q_SITUATION_VERSION,
  side: "INVESTOR",
  asOf: "2026-10-29T09:00:00.000Z",
  sections: [
    {
      source: "MANDATE",
      status: "READ",
      reason: null,
      truncated: false,
      facts: [
        {
          ref: "F1",
          statement: "Mandate: seed fintech and B2B payments in Nigeria.",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          asOf: null,
          provenance: { tool: "my_mandates", record: null, url: null },
          label: "organisation_private",
          category: "INVESTOR_THESIS",
        },
      ],
    },
  ],
  unknowns: [],
  publicTopics: ["fintech Nigeria", "B2B payments Nigeria"],
};

const BRIEF: ResearchBriefOutput = {
  question: "The Nigerian B2B payments sector against their fintech mandate.",
  market: {
    places: [{ name: "Nigeria", from: '"Nigerian B2B payments sector"' }],
    sectors: [{ name: "B2B payments", from: "F1" }],
    stage: null,
    subjects: [
      { name: "Central Bank of Nigeria", from: '"Nigerian B2B payments"' },
    ],
  },
  relevant: [{ ref: "F1", why: "Their mandate." }],
  unknowns: [],
  angles: [],
  irrelevant: [],
  summary: "The Nigerian B2B payments sector against your mandate.",
};

const REGULATOR =
  "https://www.cbn.gov.ng/PaymentsSystem/ePaymentStatistics.html";
const PRESS = "https://news.test/payments-2025";

/** Search finds a regulator page and a press page; their batch read times out. */
function provider(log: { queries: string[]; reads: string[][] }) {
  const impl: PublicWebResearchProvider = {
    code: "brave",
    search: (request) => {
      log.queries.push(request.query);
      return Promise.resolve({
        hits: [
          {
            url: REGULATOR,
            title: "e-Payment statistics",
            snippet: "NIP volumes rose 47% in 2025.",
            publishedAt: "2026-01-10",
            relevance: 0.9,
          },
          {
            url: PRESS,
            title: "Payments boom",
            snippet: "B2B payments grew 31% in 2025.",
            publishedAt: "2026-02-01",
            relevance: 0.8,
          },
        ],
        latencyMs: 1,
      });
    },
    extract: (request) => {
      log.reads.push([...request.urls]);
      // The shared batch times out; the regulator's own read succeeds.
      if (request.urls.length > 1)
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: "brave",
            failureClass: "TIMEOUT",
          }),
        );
      return Promise.resolve({
        pages: request.urls
          .filter((url) => url === REGULATOR)
          .map((url) => ({
            url,
            title: "e-Payment statistics",
            text: "e-Payment statistics. NIP transaction volumes rose 47% in 2025, the CBN reports.",
          })),
        failedUrls: request.urls.filter((url) => url !== REGULATOR),
        latencyMs: 1,
      });
    },
  };
  return impl;
}

describe("deep research reads before it states (case A)", () => {
  it("re-reads the regulator's page once, admits its fact, refuses the unread press snippet's, and places every query", async () => {
    const log = { queries: [] as string[], reads: [] as string[][] };
    const factInputs: ResearchFactsInput[] = [];
    const models: Pick<
      WorkforceModels,
      "planResearch" | "researchFacts" | "researchBrief"
    > = {
      researchBrief: () => Promise.resolve({ costUsd: 0.01, output: BRIEF }),
      planResearch: (_who, _trace, input) =>
        Promise.resolve({
          costUsd: 0.01,
          output:
            input.gaps !== FIRST_ROUND_GAPS
              ? { questions: [], internalQuery: null }
              : {
                  questions: [
                    {
                      lane: "STATISTICS",
                      query: "cbn payment systems statistics 2025 official",
                      alsoQuery: null,
                      recent: false,
                      primary: true,
                    },
                  ],
                  internalQuery: null,
                },
        }),
      researchFacts: (_who, _trace, input) => {
        factInputs.push(input);
        const index = (domain: string) =>
          Number(
            new RegExp(`S(\\d+) \\| [^\\n]* \\| ${domain}`, "u").exec(
              input.pages,
            )?.[1] ?? "0",
          );
        return Promise.resolve({
          costUsd: 0.01,
          output: {
            facts: [
              {
                statement:
                  "Nigeria's NIP transaction volumes rose 47% in 2025.",
                figure: "47%",
                asOf: "2025",
                source: index("cbn.gov.ng"),
                kind: "FIGURE",
                measure: "transaction volume growth",
                entity: null,
              },
              {
                // Its page was never read: S-numbered nowhere, refused.
                statement: "Nigerian B2B payments grew 31% in 2025.",
                figure: "31%",
                asOf: "2025",
                source: index("news.test") || 99,
                kind: "FIGURE",
                measure: "b2b payments growth",
                entity: null,
              },
            ],
            followUps: [],
          },
        });
      },
    };
    const research = workforceDeepResearch({
      service: createPublicWebResearchService({ provider: provider(log) }),
      models,
      jobSearchBudget: 4,
      situation: () => Promise.resolve(DOSSIER),
    });
    if (research === undefined) throw new Error("not composed");
    const found = await research({
      actor,
      runId: randomUUID(),
      request:
        "Q, investigate the Nigerian B2B payments sector and how it affects my fintech thesis.",
      query: "Nigerian B2B payments sector",
    });
    if (found.status !== "OK") throw new Error(found.status);

    // Every query left with the market's place.
    expect(log.queries.length).toBeGreaterThan(0);
    for (const query of log.queries)
      expect(query.toLowerCase()).toContain("nigeria");
    // The batch failed; the regulator's page was read once more, alone.
    expect(log.reads).toContainEqual([REGULATOR]);
    expect(log.reads.filter((urls) => urls.includes(PRESS))).toHaveLength(1);
    // The fact reader saw the press page as a lead, without a number.
    expect(factInputs[0]?.pages).toContain("NOT READ");
    expect(factInputs[0]?.pages).not.toMatch(/S\d+ \| [^\n]* \| news\.test/u);
    // Only the read page's fact stands.
    const facts = found.dossier?.facts ?? [];
    expect(facts.map((fact) => fact.url)).toEqual([REGULATOR]);
    expect(facts[0]?.tier).toBe("PRIMARY");
  });
});
