import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Q_SITUATION_VERSION,
  type QSituationDossier,
  type QSituationFact,
} from "@capital-q/contracts";
import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
} from "@capital-q/q-research";
import { ActorContextSchema } from "@capital-q/security";

import {
  isOwnSiteOf,
  workforceDeepResearch,
} from "../src/composition/workforce/deep-research.js";
import type {
  ResearchBriefInput,
  ResearchBriefOutput,
  ResearchPlanInput,
  ResearchPlanOutput,
  WorkforceModels,
} from "../src/composition/workforce/models.js";
import { groundBrief } from "../src/composition/workforce/research-brief.js";

/**
 * Situation-first research (owner 2026-10-29), offline: Q decides from the
 * person's whole situation what a question needs (the brief), the planner
 * reads only the brief and the facts it selected, and what may leave is
 * exactly what was judged relevant and public. Code asserts every
 * invariant; fake models, a fake provider, no live call.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

// Private markers: none may ever leave in a query.
const CHEQUE = "250000";
const NG_PIPELINE = "Kobopayx";
const OTHER_PIPELINE = "Agrimarkx";
const THIRD_PIPELINE = "Medibasex";

function fact(
  ref: string,
  statement: string,
  label: QSituationFact["label"],
): QSituationFact {
  return {
    ref,
    statement,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    asOf: null,
    provenance: { tool: "get_investor_mandate", record: null, url: null },
    label,
    category: null,
  };
}

/** An investor: mandate NG/GH/KE fintech, lending excluded, three companies. */
const DOSSIER: QSituationDossier = {
  version: Q_SITUATION_VERSION,
  side: "INVESTOR",
  asOf: "2026-10-29T12:00:00.000Z",
  sections: [
    {
      source: "MANDATE",
      status: "READ",
      reason: null,
      truncated: false,
      facts: [
        fact(
          "F1",
          `Mandate v1 (active): cheque USD ${CHEQUE} / ? / 1000000 (min / typical / max); stages seed to seed; prefers fintech, payments, nigeria, ghana, kenya; excludes digital_lending; 0 hard exclusion rule(s).`,
          "investor_private",
        ),
      ],
    },
    {
      source: "RELATIONSHIPS",
      status: "READ",
      reason: null,
      truncated: false,
      facts: [
        fact(
          "F2",
          `${NG_PIPELINE} (fintech, Nigeria): connected; next step: schedule a meeting.`,
          "relationship_shared",
        ),
        fact(
          "F3",
          `${OTHER_PIPELINE} (agritech, Kenya): interested.`,
          "relationship_shared",
        ),
        fact(
          "F4",
          `${THIRD_PIPELINE} (healthtech, Ghana): passed.`,
          "relationship_shared",
        ),
      ],
    },
  ],
  unknowns: [],
  publicTopics: [
    "fintech payments nigeria",
    "fintech payments ghana",
    "fintech payments kenya",
  ],
};

const REQUEST = "Investigate the B2B payments sector for me.";

/** The brief a model would write; it also tries what code must refuse. */
const RAW_BRIEF: ResearchBriefOutput = {
  question:
    "How the B2B payments sector in their mandate markets bears on their fintech thesis.",
  market: {
    places: [
      { name: "Nigeria", from: "F1" },
      { name: "Ghana", from: "F1" },
      { name: "Kenya", from: "F1" },
    ],
    sectors: [
      { name: "fintech", from: "F1" },
      { name: "B2B payments", from: '"B2B payments sector"' },
    ],
    stage: { name: "seed", from: "F1" },
    // A pipeline company is private: judged relevant, never sent.
    subjects: [{ name: NG_PIPELINE, from: "F2" }],
  },
  relevant: [
    { ref: "F1", why: "Their mandate: markets, sector, exclusion." },
    { ref: "F2", why: "A Nigerian fintech in their pipeline." },
    // Not in the dossier: refused by code.
    { ref: "F99", why: "Invented." },
  ],
  unknowns: [
    { what: "Their return thresholds", establish: "PERSON" },
    { what: "Licensing regime per market", establish: "RESEARCH" },
  ],
  angles: ["payments regulation per market", "competitors relevant to F2"],
  irrelevant: ["agritech and healthtech companies", "cheque sizes"],
  summary:
    "The B2B payments sector in Nigeria, Ghana and Kenya (F1), against your fintech mandate, and what it means for the Nigerian fintech in your pipeline.",
};

describe("research brief grounding", () => {
  it("selects only refs the dossier holds; only relevant public terms may leave", () => {
    const brief = groundBrief({
      raw: RAW_BRIEF,
      dossier: DOSSIER,
      words: [REQUEST],
    });
    expect(brief.selected).toEqual(["F1", "F2"]);
    const terms = brief.terms.join(" ").toLowerCase();
    for (const place of [
      "nigeria",
      "ghana",
      "kenya",
      "fintech",
      "b2b payments",
    ])
      expect(terms).toContain(place);
    // Private, or not judged relevant: never allowed to leave.
    for (const never of [NG_PIPELINE, OTHER_PIPELINE, THIRD_PIPELINE, CHEQUE])
      expect(terms).not.toContain(never.toLowerCase());
    // "seed" is not public vocabulary here (not in topics or their words).
    expect(brief.terms).not.toContain("seed");
    // The query planner reads only what could leave: a private selected
    // fact (the pipeline company) goes to the writer alone.
    expect(brief.planner).toContain("Nigeria");
    expect(brief.planner).not.toContain(NG_PIPELINE);
    expect(brief.planner).not.toContain(CHEQUE);
    expect(brief.writer).toContain(NG_PIPELINE);
    expect(brief.planner).not.toContain(OTHER_PIPELINE);
    expect(brief.planner).not.toContain(THIRD_PIPELINE);
    expect(brief.planner).not.toContain("F99");
    // For the person: no refs.
    expect(brief.summary).not.toMatch(/\bF\d/u);
    expect(brief.scope).toContain("Nigeria, Ghana, Kenya");
  });

  it("the planner never sees a private selected fact, nor model words about one (case A, Project Kola)", () => {
    const CODE_NAME = "Project Kolax";
    const dossier: QSituationDossier = {
      ...DOSSIER,
      sections: [
        ...DOSSIER.sections,
        {
          source: "BOARD",
          status: "READ",
          reason: null,
          truncated: false,
          facts: [
            fact(
              "F5",
              `Board card '${CODE_NAME}': internal code name; status first look.`,
              "investor_private",
            ),
          ],
        },
        {
          source: "PUBLIC",
          status: "READ",
          reason: null,
          truncated: false,
          facts: [
            fact(
              "F6",
              "The central bank published new payment service bank guidelines.",
              "public_external",
            ),
          ],
        },
      ],
    };
    const brief = groundBrief({
      raw: {
        ...RAW_BRIEF,
        market: {
          ...RAW_BRIEF.market,
          subjects: [{ name: CODE_NAME, from: "F5" }],
        },
        relevant: [
          { ref: "F5", why: `${CODE_NAME} is the deal in view.` },
          { ref: "F6", why: "Public regulatory news." },
        ],
        angles: [`how it affects ${CODE_NAME}`, "payments regulation"],
        unknowns: [{ what: `${CODE_NAME} licence`, establish: "RESEARCH" }],
      },
      dossier,
      words: [REQUEST],
    });
    expect(brief.selected).toEqual(["F5", "F6"]);
    expect(brief.planner).not.toContain(CODE_NAME);
    expect(brief.planner).not.toContain("Kolax");
    expect(brief.planner).toContain("payments regulation");
    expect(brief.planner).toContain("payment service bank guidelines");
    // The writer still reads the whole brief.
    expect(brief.writer).toContain(CODE_NAME);
  });

  it("with no place in words or context the scope is global", () => {
    const brief = groundBrief({
      raw: {
        ...RAW_BRIEF,
        market: { places: [], sectors: [], stage: null, subjects: [] },
      },
      dossier: { ...DOSSIER, publicTopics: [] },
      words: [REQUEST],
    });
    expect(brief.scope).toMatch(/^Scope: global/u);
    expect(brief.planner).toContain("research globally");
  });
});

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

function run(options: {
  readonly situation: QSituationDossier | null;
  readonly plan: ResearchPlanOutput;
  readonly sent: string[];
  readonly plans: ResearchPlanInput[];
  readonly briefs: ResearchBriefInput[];
}) {
  const models: Pick<
    WorkforceModels,
    "planResearch" | "researchFacts" | "researchBrief"
  > = {
    researchBrief: (_who, _trace, input) => {
      options.briefs.push(input);
      return Promise.resolve({ costUsd: 0.01, output: RAW_BRIEF });
    },
    planResearch: (_who, _trace, input) => {
      options.plans.push(input);
      return Promise.resolve(
        options.plans.length === 1
          ? { costUsd: 0.01, output: options.plan }
          : { costUsd: 0.01, output: { questions: [], internalQuery: null } },
      );
    },
    researchFacts: () =>
      Promise.resolve({
        costUsd: 0.01,
        output: { facts: [], followUps: [] },
      }),
  };
  const research = workforceDeepResearch({
    service: createPublicWebResearchService({
      provider: provider(options.sent),
    }),
    models,
    jobSearchBudget: 20,
    situation: () => Promise.resolve(options.situation),
  });
  if (research === undefined) throw new Error("not composed");
  return research({
    actor,
    runId: randomUUID(),
    request: REQUEST,
    query: REQUEST,
  });
}

describe("deep research from the person's situation", () => {
  it("an investor's mandate markets reach the plan and the queries; private names and figures never leave", async () => {
    const sent: string[] = [];
    const plans: ResearchPlanInput[] = [];
    const briefs: ResearchBriefInput[] = [];
    const found = await run({
      situation: DOSSIER,
      plan: {
        questions: [
          q("REGULATION", "nigeria b2b payments regulation"),
          q("MARKET_SIZE", "b2b payments market size kenya ghana"),
          // The model tries private context: code drops it.
          q("PIPELINE", `${NG_PIPELINE} b2b payments nigeria ${CHEQUE}`),
          q("OTHER", `${OTHER_PIPELINE} agritech kenya`),
        ],
        internalQuery: null,
      },
      sent,
      plans,
      briefs,
    });
    expect(found.status).toBe("OK");
    // One brief call, from the whole situation.
    expect(briefs).toHaveLength(1);
    expect(briefs[0]?.situation).toContain(OTHER_PIPELINE);
    // The planner reads the public-safe part of the brief only.
    const planned = plans[0];
    expect(planned?.brief).toContain("Nigeria");
    expect(planned?.brief).not.toContain(NG_PIPELINE);
    expect(planned?.brief).not.toContain(OTHER_PIPELINE);
    expect(planned?.brief).not.toContain(THIRD_PIPELINE);
    // The queries carry their markets, and nothing private.
    const all = sent.join(" | ").toLowerCase();
    expect(all).toContain("nigeria");
    expect(all).toContain("kenya");
    for (const never of [NG_PIPELINE, OTHER_PIPELINE, THIRD_PIPELINE, CHEQUE])
      expect(all).not.toContain(never.toLowerCase());
    // The writer gets the brief; the report states the scope.
    if (found.status !== "OK") throw new Error("not OK");
    expect(found.dossier?.brief?.writer).toContain("[MANDATE]");
    expect(found.dossier?.investigation?.scope).toContain("Nigeria");
  });

  it("without a situation, a country the person never named never leaves, and the scope is global", async () => {
    const sent: string[] = [];
    const found = await run({
      situation: null,
      plan: {
        questions: [q("REGULATION", "b2b payments regulation nigeria")],
        internalQuery: null,
      },
      sent,
      plans: [],
      briefs: [],
    });
    expect(sent.join(" ").toLowerCase()).not.toContain("nigeria");
    if (found.status !== "OK") throw new Error("not OK");
    expect(found.dossier?.investigation?.scope).toMatch(/^Scope: global/u);
  });

  it("a state the person names places the question in its country", async () => {
    const sent: string[] = [];
    const found = await workforceDeepResearch({
      service: createPublicWebResearchService({ provider: provider(sent) }),
      models: {
        planResearch: () =>
          Promise.resolve({
            costUsd: 0.01,
            output: {
              questions: [q("REGULATION", "nigeria fintech regulation")],
              internalQuery: null,
            },
          }),
        researchFacts: () =>
          Promise.resolve({
            costUsd: 0.01,
            output: { facts: [], followUps: [] },
          }),
      },
      jobSearchBudget: 4,
    })?.({
      actor,
      runId: randomUUID(),
      request: "Lagos State fintech regulation",
      query: "Lagos State fintech regulation",
    });
    expect(sent.join(" ").toLowerCase()).toContain("nigeria");
    if (found?.status !== "OK") throw new Error("not OK");
    expect(found.dossier?.investigation?.scope).toContain("Nigeria");
  });
});

describe("a company's own site (live 2026-10-29, run A)", () => {
  it("is a proper name's own domain, never a market label's prefix", () => {
    expect(isOwnSiteOf("www.paymentsdive.com", "payments")).toBe(false);
    expect(isOwnSiteOf("www.paymentsdive.com", "Payments")).toBe(false);
    expect(isOwnSiteOf("www.payoneer.com", "Payoneer")).toBe(true);
    expect(isOwnSiteOf("paystackhq.com", "Paystack")).toBe(true);
    expect(isOwnSiteOf("www.corpay.com", "global payments")).toBe(false);
  });
});
