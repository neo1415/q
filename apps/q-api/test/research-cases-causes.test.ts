import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QSituationDossier } from "@capital-q/contracts";
import type { AnalysisDocumentResult } from "@capital-q/q-core";
import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
} from "@capital-q/q-research";
import { ActorContextSchema } from "@capital-q/security";

import {
  analysisContent,
  recordsCitedAsWeb,
  writeAnalysisWithReview,
} from "../src/composition/workforce/analysis.js";
import {
  createSpend,
  FIRST_ROUND_GAPS,
  FIRST_ROUND_RETRY_GAPS,
  RECOVERY_ROUND_GAPS,
  workforceDeepResearch,
} from "../src/composition/workforce/deep-research.js";
import type {
  ResearchBriefOutput,
  ResearchPlanInput,
  ResearchPlanOutput,
  WorkforceModels,
} from "../src/composition/workforce/models.js";
import { groundBrief } from "../src/composition/workforce/research-brief.js";

import { loadCases, type AcceptanceCase } from "./research-acceptance/case.js";

/**
 * The causes of the 2026-10-29 evening recordings' failures (cases B, C,
 * E, F, G), each reproduced from what was recorded -- the case's own
 * dossier and the models' recorded answers -- and asserted by code. The
 * recordings themselves need re-recording after these fixes (the prompts
 * changed); these tests hold the causes offline.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

const caseOf = (prefix: string): AcceptanceCase => {
  const one = loadCases().find((each) => each.id.startsWith(`${prefix}-`));
  if (one === undefined) throw new Error(`no case ${prefix}`);
  return one;
};

/** A provider that answers every query with one page; records queries. */
function provider(sent: string[]): PublicWebResearchProvider {
  return {
    code: "brave",
    search: (request) => {
      sent.push(request.query);
      return Promise.resolve({
        hits: [
          {
            url: `https://news.test/${encodeURIComponent(request.query)}`,
            title: "Payments news",
            snippet: "Payments news.",
            publishedAt: "2026-10-01",
            relevance: 0.8,
          },
        ],
        latencyMs: 1,
      });
    },
    extract: (request) =>
      Promise.resolve({
        pages: request.urls.map((url) => ({
          url,
          title: "Payments news",
          text: "Payments news.",
        })),
        failedUrls: [],
        latencyMs: 1,
      }),
  };
}

const q = (lane: string, query: string) => ({
  lane,
  query,
  alsoQuery: null,
  recent: false,
  primary: false,
});

function research(options: {
  readonly situation: QSituationDossier;
  readonly brief: ResearchBriefOutput;
  readonly plans: (input: ResearchPlanInput) => ResearchPlanOutput | null;
  readonly sent: string[];
  readonly request: string;
}) {
  const models: Pick<
    WorkforceModels,
    "planResearch" | "researchFacts" | "researchBrief"
  > = {
    researchBrief: () =>
      Promise.resolve({ costUsd: 0.01, output: options.brief }),
    planResearch: (_who, _trace, input) => {
      const output = options.plans(input);
      return Promise.resolve(
        output === null ? null : { costUsd: 0.01, output },
      );
    },
    researchFacts: () =>
      Promise.resolve({
        costUsd: 0.01,
        output: { facts: [], followUps: [] },
      }),
  };
  const run = workforceDeepResearch({
    service: createPublicWebResearchService({
      provider: provider(options.sent),
    }),
    models,
    jobSearchBudget: 40,
    situation: () => Promise.resolve(options.situation),
  });
  if (run === undefined) throw new Error("not composed");
  return run({
    actor,
    runId: randomUUID(),
    request: options.request,
    query: options.request,
  });
}

/** The brief case B's model wrote (recorded 2026-10-29), its market part. */
function briefB(): ResearchBriefOutput {
  return {
    question:
      "Research the competitive landscape and regulatory environment for LedgerBridge's Nigerian B2B payments market.",
    market: {
      places: [{ name: "Nigeria", from: "F9" }],
      sectors: [
        { name: "B2B payments", from: "F9" },
        { name: "Fintech", from: "F9" },
      ],
      stage: { name: "Seed", from: "F9" },
      subjects: [
        { name: "Paystack", from: "F6" },
        { name: "Central Bank of Nigeria", from: "F3" },
      ],
    },
    relevant: [{ ref: "F9", why: "The company, its country and sectors." }],
    unknowns: [],
    angles: ["Competitive comparison with Paystack and Flutterwave"],
    irrelevant: ["Private fundraising and runway figures"],
    summary: "Nigeria's B2B payments competition and regulation.",
  };
}

describe("cases B and G: a founder's own country is public and travels", () => {
  it("reads the country code a founder's public topics carry (B: 'B2B payments NG')", () => {
    const one = caseOf("B");
    expect(one.situation.publicTopics).toContain("B2B payments NG");
    const brief = groundBrief({
      raw: briefB(),
      dossier: one.situation,
      words: [one.request],
    });
    expect(brief.terms).toContain("Nigeria");
    // Before: "MARKET: the place in question is private context", and the
    // planner wrote "global B2B payments competitors 2026".
    expect(brief.planner).toContain("MARKET: places: Nigeria");
    expect(brief.planner).not.toContain("the place in question is private");
  });

  it("every query B's planner wrote leaves with Nigeria; G's with Kenya", async () => {
    // B's and G's recorded planner queries that left with no place.
    const recorded = {
      B: [
        "b2b payments competitors 2026",
        "b2b payment market 2026",
        "fintech payments regulation 2026",
        "payments licensing regulatory 2025 2026",
      ],
      G: [
        "fintech payments competitors 2026",
        "payments market 2026",
        "fintech payments trends 2026",
        "payments adoption 2026",
      ],
    } as const;
    const briefG: ResearchBriefOutput = {
      ...briefB(),
      question: "What changed in ShambaPay's Kenyan market this year.",
      market: {
        places: [{ name: "Kenya", from: "F2" }],
        sectors: [
          { name: "Agri-fintech", from: "F2" },
          { name: "Payments", from: "F2" },
        ],
        stage: null,
        subjects: [{ name: "Pula", from: "F1" }],
      },
      relevant: [{ ref: "F2", why: "The company and its country." }],
      angles: [],
    };
    const runs: readonly (readonly ["B" | "G", string, ResearchBriefOutput])[] =
      [
        ["B", "nigeria", briefB()],
        ["G", "kenya", briefG],
      ];
    for (const [prefix, place, raw] of runs) {
      const one = caseOf(prefix);
      const sent: string[] = [];
      const found = await research({
        situation: one.situation,
        brief: raw,
        request: one.request,
        sent,
        plans: (input) =>
          input.gaps === FIRST_ROUND_GAPS
            ? {
                questions: recorded[prefix].map((query, index) =>
                  q(`LANE_${String(index)}`, query),
                ),
                internalQuery: null,
              }
            : { questions: [], internalQuery: null },
      });
      expect(found.status).toBe("OK");
      expect(sent.length).toBeGreaterThanOrEqual(4);
      for (const query of sent) expect(query.toLowerCase()).toContain(place);
      for (const marker of one.expect.privateMarkers)
        expect(sent.join(" | ")).not.toContain(marker);
    }
  });
});

/** Case E's recorded brief: global, one public sector, no angles. */
function briefE(): ResearchBriefOutput {
  return {
    question:
      "Research the global embedded finance market and prepare a short, evidence-backed report.",
    market: {
      places: [],
      sectors: [
        { name: "embedded finance", from: '"embedded finance market"' },
      ],
      stage: null,
      subjects: [
        {
          name: "embedded finance platforms and providers",
          from: '"embedded finance market"',
        },
      ],
    },
    relevant: [],
    unknowns: [
      {
        what: "Current market size, growth estimates, segment economics, leading participants.",
        establish: "RESEARCH",
      },
    ],
    angles: [],
    irrelevant: [],
    summary: "The global embedded finance market.",
  };
}

const PLANNED_E = {
  questions: [
    q("MARKET_SIZE", "global embedded finance market size 2025"),
    q("COMPETITORS", "global embedded finance platform competitors"),
    q("REGULATION", "global embedded finance regulation licensing"),
    q("DEVELOPMENTS", "embedded finance news 2026"),
    q("ALTERNATIVES", "embedded finance alternatives traditional banking"),
    q("FUNDING_NEWS", "embedded finance funding 2026"),
  ],
  internalQuery: null,
};

describe("case E: a global question gets its plan", () => {
  it("the planner is not told to plan 'these angles only' when no angle is shown", () => {
    const one = caseOf("E");
    const brief = groundBrief({
      raw: briefE(),
      dossier: one.situation,
      words: [one.request],
    });
    expect(brief.planner).not.toContain("these angles only");
    expect(brief.planner).toContain("plan the full investigation");
    expect(brief.planner).toContain("MARKET: global");
  });

  it("an empty first plan is asked again with what went wrong, never the same request", async () => {
    const one = caseOf("E");
    const gaps: string[] = [];
    const sent: string[] = [];
    const found = await research({
      situation: one.situation,
      brief: briefE(),
      request: one.request,
      sent,
      plans: (input) => {
        gaps.push(input.gaps);
        // As recorded: the first plan came back with no questions.
        return gaps.length === 1
          ? { questions: [], internalQuery: "embedded finance global market" }
          : input.gaps === FIRST_ROUND_RETRY_GAPS
            ? PLANNED_E
            : { questions: [], internalQuery: null };
      },
    });
    expect(gaps.slice(0, 2)).toEqual([
      FIRST_ROUND_GAPS,
      FIRST_ROUND_RETRY_GAPS,
    ]);
    if (found.status !== "OK") throw new Error("not OK");
    expect(found.dossier?.investigation?.reduced).toBeUndefined();
    expect(sent.length).toBeGreaterThanOrEqual(6);
  });

  it("a run reduced in round one asks for its plan again and runs it (the recorded later plan was dropped)", async () => {
    const one = caseOf("E");
    const gaps: string[] = [];
    const sent: string[] = [];
    const found = await research({
      situation: one.situation,
      brief: briefE(),
      request: one.request,
      sent,
      plans: (input) => {
        gaps.push(input.gaps);
        // As recorded: an empty plan, then the retry refused (null).
        if (gaps.length === 1) return { questions: [], internalQuery: null };
        if (gaps.length === 2) return null;
        return input.gaps === RECOVERY_ROUND_GAPS
          ? PLANNED_E
          : { questions: [], internalQuery: null };
      },
    });
    expect(gaps[2]).toBe(RECOVERY_ROUND_GAPS);
    if (found.status !== "OK") throw new Error("not OK");
    // Round one searched the request's own words; then the plan ran.
    expect(sent[0]).toContain("embedded finance market");
    expect(sent).toContain("embedded finance competitors");
    expect(sent).toContain("embedded finance news 2026");
    expect(sent.length).toBeGreaterThanOrEqual(7);
    expect(found.dossier?.investigation?.reduced).toBeUndefined();
  });
});

describe("case F: the filed report keeps Capital Q records apart", () => {
  // The sentence the last of case F's three recorded drafts still had.
  const MIXED =
    "- The 59% readiness statistic covers 44 respondents and does not establish readiness for LedgerBridge or any other target [S38].";
  const draft = (): AnalysisDocumentResult => ({
    title: "Nigerian payments news and your pipeline",
    summary: "Payment service providers face new rules [S2].",
    sections: [
      {
        heading: "Evidence gaps",
        body: `${MIXED}\n- LedgerBridge's licensing is not in the record (Capital Q record).`,
      },
    ],
    topRecommendations: [],
    gaps: [],
  });

  it("files no sentence that cites a web source for a record, after the rewrites ran out", async () => {
    const written = await writeAnalysisWithReview({
      models: {
        // Every draft keeps the mixed sentence, as case F's did.
        writeAnalysis: () =>
          Promise.resolve({ costUsd: 0.01, output: draft() }),
        critiqueAnalysis: () =>
          Promise.resolve({
            costUsd: 0.01,
            output: { passes: true, score: 80, issues: [], strengths: [] },
          }),
      },
      who: { tenantId: "t", userId: "u" },
      trace: null,
      spend: createSpend(5),
      canContinue: () => Promise.resolve(true),
      inputs: {
        principalName: "the investor",
        request: "How does the sector news affect my pipeline?",
        purpose: "A report.",
        today: "2026-10-29",
        company: "",
        research: "",
        sources: "",
        sourceIndices: new Set([2, 38]),
        recordNames: ["LedgerBridge"],
      },
    });
    if (written === null) throw new Error("no draft");
    expect(written.review.drafts).toBe(3);
    expect(recordsCitedAsWeb(written.draft, ["LedgerBridge"])).toEqual([]);
    const content = analysisContent({
      draft: written.draft,
      review: written.review,
      sources: [2, 38].map((index) => ({
        index,
        url: `https://example.com/${String(index)}`,
        domain: "example.com",
        title: null,
        publishedAt: null,
      })),
      facts: [],
      seed: "s",
    });
    // As the acceptance check reads the report: no clause naming the
    // record cites [S n] unless marked as the record -- the open points
    // included.
    const text = [
      ...content.sections.map((section) => section.body),
      ...content.gaps,
    ].join("\n");
    for (const clause of text
      .split(/(?<=[.!?])\s+|\n+/u)
      .flatMap((sentence) => sentence.split(/;\s+|\s\|\s/u))) {
      if (!clause.includes("LedgerBridge")) continue;
      if (/\(capital q record\)/iu.test(clause)) continue;
      expect(clause).not.toMatch(/\[S\d/u);
    }
    // What the record says still stands, marked apart.
    expect(text).toContain(
      "LedgerBridge's licensing is not in the record (Capital Q record).",
    );
    expect(content.gaps.join("\n")).toContain("Q removed 1 sentence");
  });
});
