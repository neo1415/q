import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QAccountDigestSchema,
  type QAccountDigest,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  conditionWords,
  predicate,
  revenueStateOf,
  runConditionedCompanyList,
  type ListConditions,
} from "../src/q/list-conditions.js";
import { fitFixture } from "./fit-fixture.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Audit 2026-11-15 RC2: ranking shortcuts dropped the person's stated
 * condition. Each live turn shape is replayed through the answer seam with
 * the reading the turn reader (v89) gives it; fake model, no provider, no
 * network. A condition no lane can apply goes to the full path, never the
 * plain list.
 *
 * Investor (Zino Aviation, savanna-seed): "show me the ones with actual
 * revenue" (run e8d59713), "pre-revenue, but unusually strong" (81dea17d),
 * "outside my preferred sectors" (30d18535) -- each got "Ranked by fit with
 * your mandate, the top ten: Nixo at 10, Halyard Security at 10...".
 * Founder (P0, F7-13 run b96a8f07, F7-09 run 83802d51): "leave out the ones
 * I'm already talking to" listed Zino Aviation first; "which would be poor
 * fits" returned the same shortlist.
 */

const NO_CONDITIONS: ListConditions = {
  relationship: null,
  revenue: null,
  sector: null,
  stage: null,
  geography: null,
  order: "BEST_FIRST",
};

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "COMPARING_OPPORTUNITIES",
});

function ok(
  proposal: QToolProposal,
  toolName: string,
  data: unknown,
): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "NETWORK_VISIBLE",
    result: { ok: true, data },
    latencyMs: 1,
  };
}

const ANALYST = {
  kind: "JSON" as const,
  value: {
    answer: "The analyst's own answer.",
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  },
};

function gatewayWith() {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [ANALYST, ANALYST, ANALYST],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  return { alpha, gateway };
}

function repositoriesFor(asked: string, run: string) {
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: randomUUID(),
      runId: run,
      role: "USER",
      content: asked,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as never,
  ];
  const completed: Completed[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage;
        messages.push(message);
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: {
      append: (
        _tx: unknown,
        input: { eventType?: string; payload?: unknown },
      ) => {
        if (input.eventType === "q.message.completed") {
          completed.push(input.payload as Completed);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  return { repositories, completed };
}

type Completed = {
  message: {
    text: string;
    blocks?: { kind: string; title?: string; cards?: { name: string }[] }[];
  };
};

function cardsOf(completed: readonly Completed[]): string[] {
  return (completed.at(-1)?.message.blocks ?? [])
    .filter((block) => block.kind === "ANSWER_CARDS")
    .flatMap((block) => block.cards ?? [])
    .map((card) => card.name);
}

function digestOf(
  side: "INVESTOR" | "COMPANY",
  counterparts: readonly string[],
): QAccountDigest {
  return QAccountDigestSchema.parse({
    side,
    relationships: [],
    relationshipsTotal: counterparts.length,
    byStage:
      counterparts.length === 0 ? {} : { CONNECTED: counterparts.length },
    relationshipCounterpartIds: [...counterparts],
    waiting: [],
    waitingTotal: 0,
    meetings: [],
    work: [],
    requests: [],
    gateq: null,
    recent: [],
    unread: [],
    readAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// Investor lane.
// ---------------------------------------------------------------------

const CO = (n: number) =>
  `7c1d7a10-0b0e-4e7a-9a0c-${String(n).padStart(12, "0")}`;
type Company = {
  readonly id: string;
  readonly name: string;
  readonly sector: "STRONG" | "PARTIAL" | "MISMATCH" | "UNKNOWN";
  readonly stage: "STRONG" | "PARTIAL" | "MISMATCH" | "UNKNOWN";
  /** Published monthly revenue; null: no figures published. */
  readonly revenue: number | null;
};
const COMPANIES: readonly Company[] = [
  {
    id: CO(1),
    name: "Nixo",
    sector: "STRONG",
    stage: "STRONG",
    revenue: 42_000,
  },
  {
    id: CO(2),
    name: "Halyard Security",
    sector: "STRONG",
    stage: "STRONG",
    revenue: null,
  },
  {
    id: CO(3),
    name: "Tensorgate",
    sector: "MISMATCH",
    stage: "STRONG",
    revenue: 0,
  },
  {
    id: CO(4),
    name: "Shiftwell",
    sector: "MISMATCH",
    stage: "PARTIAL",
    revenue: 9_000,
  },
  {
    id: CO(5),
    name: "Clearwater Assurance",
    sector: "UNKNOWN",
    stage: "PARTIAL",
    revenue: 15_000,
  },
  {
    id: CO(6),
    name: "Tangible",
    sector: "PARTIAL",
    stage: "MISMATCH",
    revenue: 0,
  },
];

function fitData(company: Company) {
  return fitFixture(company.id, company.name, {
    SECTOR: company.sector,
    STAGE: company.stage,
    GEOGRAPHY: "STRONG",
  }).result.data as { name: string; profile: unknown };
}

function figuresOf(company: Company) {
  return company.revenue === null
    ? { companyId: company.id, figures: [], status: "NONE" }
    : {
        companyId: company.id,
        status: "AVAILABLE",
        figures: [
          {
            key: "financial.monthly_revenue",
            statement: `Monthly revenue ${String(company.revenue)} USD`,
            value: { amount: company.revenue, currency: "USD" },
            asOf: "2026-10-01",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            lifecycleStatus: "CURRENT",
          },
        ],
      };
}

const investorExecute: QToolPort["execute"] = (proposal) => {
  const args = proposal.arguments as Record<string, unknown>;
  const byId = (id: unknown) => COMPANIES.find((one) => one.id === id);
  switch (proposal.name) {
    case "discover_companies":
      return Promise.resolve(
        ok(proposal, "discovery.companies", {
          order: "FIT",
          total: COMPANIES.length,
          sectors: [],
          unknownSectors: [],
          companies: COMPANIES.map((one) => ({
            companyId: one.id,
            name: one.name,
            stageCode: "seed",
            headquartersCountry: "KE",
            shortDescription: null,
            sectors: [],
          })),
        }),
      );
    case "fit_top_candidates": {
      const ids = Array.isArray(args["companyIds"])
        ? (args["companyIds"] as string[])
        : COMPANIES.slice(0, Number(args["limit"] ?? 10)).map((one) => one.id);
      const entries = ids.flatMap((id) => {
        const company = byId(id);
        if (company === undefined) return [];
        const fit = fitData(company);
        return [{ name: fit.name, line: null, profile: fit.profile }];
      });
      return Promise.resolve(
        ok(proposal, "fit.top_candidates", {
          status: "OK",
          comparison: { entries },
        }),
      );
    }
    case "fit_profile": {
      const company = byId(args["companyId"]) ?? COMPANIES[0];
      return Promise.resolve(
        ok(
          proposal,
          "fit.profile",
          company === undefined ? null : fitData(company),
        ),
      );
    }
    case "read_company_figures": {
      const company = byId(args["companyId"]);
      return Promise.resolve(
        ok(
          proposal,
          "company.figures.read",
          company === undefined ? null : figuresOf(company),
        ),
      );
    }
    case "list_my_relationships":
      return Promise.resolve(
        ok(proposal, "relationship.list_mine", {
          side: "INVESTOR",
          relationships: [],
          saved: [],
        }),
      );
    default:
      return Promise.resolve(ok(proposal, "unused", null));
  }
};

function investorTurn(
  asked: string,
  reading: Partial<QAnswerRequest>,
  offeredNames: readonly (readonly [string, string])[] = [
    ["discover_companies", "discovery.companies"],
    ["fit_top_candidates", "fit.top_candidates"],
    ["fit_profile", "fit.profile"],
    ["read_company_figures", "company.figures.read"],
    ["list_my_relationships", "relationship.list_mine"],
  ],
) {
  const run = randomUUID();
  const now = new Date();
  const { alpha, gateway } = gatewayWith();
  const { repositories, completed } = repositoriesFor(asked, run);
  const tools: QToolPort = {
    offer: () =>
      Promise.resolve(offeredNames.map(([name, tool]) => offered(name, tool))),
    execute: investorExecute,
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => Promise.resolve(digestOf("INVESTOR", [])),
  });
  const investorOrganisationId = randomUUID();
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: run,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [
      {
        kind: "INVESTOR_MANDATE",
        contextLabel: "investor_private",
        sensitivity: "CONFIDENTIAL",
        layer: "STRUCTURED_STATE",
        factCategories: ["INVESTOR_THESIS"],
        projection: "FULL",
        rights: {
          canUseForReasoning: true,
          canDiscloseExistence: true,
          canQuote: true,
          canProvideLink: false,
        },
        filter: { tenantId: TENANT, investorOrganisationId },
        isEvidence: true,
        subject: { kind: "INVESTOR_ORGANISATION", investorOrganisationId },
      },
    ],
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: now.toISOString(),
    revalidateAfter: new Date(now.getTime() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan,
    turnKind: "QUESTION_TO_Q",
    ...reading,
  } as unknown as QAnswerRequest;
  return { seam, request, completed, alpha };
}

const named = (names: readonly string[]) =>
  COMPANIES.filter((one) => names.includes(one.name));

describe("RC2 investor lane: the stated condition is applied before ranking", () => {
  it("'show me the ones with actual revenue' (run e8d59713) lists only companies with revenue on record, and names the unknown", async () => {
    const asked = "Okay, Um, show me the ones with actual revenue";
    const { seam, request, completed, alpha } = investorTurn(asked, {
      questionKind: "FIT",
      fitQuestion: { text: asked, count: null },
      listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    const cards = cardsOf(completed);
    expect(cards.sort()).toEqual(
      ["Clearwater Assurance", "Nixo", "Shiftwell"].sort(),
    );
    // Final check: no card is a company without revenue on record.
    for (const company of named(cards)) {
      expect(company.revenue ?? 0).toBeGreaterThan(0);
    }
    const text = completed.at(-1)?.message.text ?? "";
    expect(text).toContain("have revenue on record");
    expect(text).not.toMatch(/^Ranked by fit with your mandate, the top/u);
    // Unknown is said as unknown, never as no revenue.
    expect(text).toContain(
      "For Halyard Security, whether they have revenue isn't on record",
    );
    expect(text).not.toContain("Tensorgate");
  });

  it("'pre-revenue, but unusually strong' (run 81dea17d, read as DISCOVER_COMPANIES) lists only pre-revenue companies", async () => {
    const asked =
      "show me businesses that are pre-revenue, but have unusually strong reasons to be interesting";
    const { seam, request, completed, alpha } = investorTurn(asked, {
      questionKind: "DISCOVER_COMPANIES",
      discoverCompanies: {
        text: asked,
        sectors: [],
        countries: [],
        stages: [],
        count: null,
        ranking: "FIT",
        mandateRelevant: true,
        previous: false,
        raising: false,
      },
      listConditions: { ...NO_CONDITIONS, revenue: "PRE_REVENUE" },
    });
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    const cards = cardsOf(completed);
    expect(cards.sort()).toEqual(["Tangible", "Tensorgate"]);
    for (const company of named(cards)) expect(company.revenue).toBe(0);
    const text = completed.at(-1)?.message.text ?? "";
    expect(text).toContain("are pre-revenue");
    expect(text).not.toMatch(/the top ten/u);
  });

  it("'outside my preferred sectors' (run 30d18535) lists only sector mismatches; unknown sector is named, not shown", async () => {
    const asked =
      "Are there any promising opportunities outside my preferred sectors that are worth a look, keep them separate from my normal matches";
    const { seam, request, completed } = investorTurn(asked, {
      questionKind: "FIT",
      fitQuestion: { text: asked, count: null },
      listConditions: { ...NO_CONDITIONS, sector: "OUTSIDE" },
    });
    await seam.answer(request);
    const cards = cardsOf(completed);
    expect(cards.sort()).toEqual(["Shiftwell", "Tensorgate"]);
    for (const company of named(cards)) expect(company.sector).toBe("MISMATCH");
    const text = completed.at(-1)?.message.text ?? "";
    expect(text).toContain("are outside your preferred sectors");
    expect(text).toContain("Clearwater Assurance");
    expect(text).not.toContain("Nixo");
  });

  it("weakest fits come weakest first", async () => {
    const asked = "Which of my matches are the weakest fits?";
    const { seam, request, completed } = investorTurn(asked, {
      questionKind: "FIT",
      fitQuestion: { text: asked, count: 3 },
      listConditions: { ...NO_CONDITIONS, order: "WORST_FIRST" },
    });
    await seam.answer(request);
    const text = completed.at(-1)?.message.text ?? "";
    expect(text).toContain("weakest first");
    const cards = cardsOf(completed);
    expect(cards).toHaveLength(3);
    expect(cards).not.toContain("Nixo");
    expect(cards).not.toContain("Halyard Security");
  });

  it("a revenue condition with no figures read offered goes to the full path, never the plain ranking", async () => {
    const asked = "only the ones with actual revenue";
    const { seam, request, completed, alpha } = investorTurn(
      asked,
      {
        questionKind: "FIT",
        fitQuestion: { text: asked, count: null },
        listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
      },
      [
        ["discover_companies", "discovery.companies"],
        ["fit_top_candidates", "fit.top_candidates"],
        ["fit_profile", "fit.profile"],
        ["list_my_relationships", "relationship.list_mine"],
      ],
    );
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
    const text = completed.at(-1)?.message.text ?? "";
    expect(text).not.toMatch(/Ranked by fit with your mandate/u);
    expect(cardsOf(completed)).not.toContain("Halyard Security");
  });

  it("a plain fit question without conditions keeps the existing ranking lane", async () => {
    const asked = "What are the strongest fits for my mandate?";
    const { seam, request, completed, alpha } = investorTurn(asked, {
      questionKind: "FIT",
      fitQuestion: { text: asked, count: null },
    });
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    expect(cardsOf(completed)).toContain("Nixo");
  });
});

describe("RC2 conditioned list over the companies just shown", () => {
  it("'the ones with actual revenue' of those shown is those only", async () => {
    const result = await runConditionedCompanyList({
      conditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
      within: [CO(1), CO(2), CO(3)],
      count: null,
      discover: null,
      tools: { execute: investorExecute },
      context: {} as Parameters<typeof runConditionedCompanyList>[0]["context"],
      available: new Set([
        "fit_profile",
        "fit_top_candidates",
        "read_company_figures",
      ]),
      own: Promise.resolve(null),
      inTouch: Promise.resolve(new Set<string>()),
    });
    expect(result?.shown.map((fit) => fit.name)).toEqual(["Nixo"]);
    expect(result?.text).toMatch(
      /^Of the three companies I just showed, one has revenue on record\./u,
    );
    expect(result?.text).toContain("Halyard Security");
  });
});

describe("revenue from published figures", () => {
  it("positive is revenue, a stated zero is pre-revenue, nothing or a contradiction is unknown", () => {
    const fig = (key: string, value: unknown, extra: object = {}) => ({
      key,
      statement: "",
      value,
      asOf: null,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      ...extra,
    });
    expect(
      revenueStateOf({ figures: [fig("financial.mrr", { amount: "1200" })] }),
    ).toBe("HAS_REVENUE");
    expect(
      revenueStateOf({ figures: [fig("financial.revenue", { amount: 0 })] }),
    ).toBe("PRE_REVENUE");
    expect(revenueStateOf({ figures: [], status: "NONE" })).toBe("UNKNOWN");
    expect(revenueStateOf(null)).toBe("UNKNOWN");
    // A forecast, a target and a business model are not revenue.
    expect(
      revenueStateOf({
        figures: [
          fig("financial.revenue", { amount: 5000, forecast: true }),
          fig("financial.revenue_target", { amount: 9000 }),
          fig("business.revenue_model", { amount: 1 }),
        ],
      }),
    ).toBe("UNKNOWN");
    // An earlier reading is history, not today's figure.
    expect(
      revenueStateOf({
        figures: [fig("financial.revenue", { amount: 100 }, { earlier: true })],
      }),
    ).toBe("UNKNOWN");
    // Contradictory current claims coexist: never the favourable one.
    expect(
      revenueStateOf({
        figures: [
          fig("financial.revenue", { amount: 100 }),
          fig("financial.mrr", { amount: 0 }),
        ],
      }),
    ).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------
// Founder lane (investor prospects).
// ---------------------------------------------------------------------

const COMPANY = "61000000-0000-4000-8000-000000000001";
const ZINO = "62000000-0000-4000-8000-000000000001";
const CAPE = "62000000-0000-4000-8000-000000000002";
const CHIDI = "62000000-0000-4000-8000-000000000003";
const LAGOS = "62000000-0000-4000-8000-000000000004";
const BAOBAB = "62000000-0000-4000-8000-000000000005";

type Standing = "MET" | "NOT_MET" | "UNKNOWN";
const prospect = (
  id: string,
  name: string,
  fit: { stage: Standing; sector: Standing; geography: Standing },
) => ({
  investorOrganisationId: id,
  name,
  investorType: "VC",
  hqCountry: "NG",
  publicDescription: null,
  deploymentState: "ACTIVELY_INVESTING",
  reasons: [],
  label: "likely fit, not evidence of interest",
  gate: null,
  publishedFit: fit,
  fitKnown: Object.values(fit).some((one) => one === "MET"),
});

const PROSPECTS = [
  prospect(ZINO, "Zino Aviation", {
    stage: "MET",
    sector: "MET",
    geography: "MET",
  }),
  prospect(CAPE, "Cape Meridian Growth (fictional)", {
    stage: "NOT_MET",
    sector: "MET",
    geography: "NOT_MET",
  }),
  prospect(CHIDI, "Chidi Nwosu Angel Investments (fictional)", {
    stage: "UNKNOWN",
    sector: "UNKNOWN",
    geography: "UNKNOWN",
  }),
  prospect(LAGOS, "Lagos Angels (fictional)", {
    stage: "MET",
    sector: "MET",
    geography: "MET",
  }),
  prospect(BAOBAB, "Baobab Capital (fictional)", {
    stage: "MET",
    sector: "NOT_MET",
    geography: "MET",
  }),
];

function founderTurn(asked: string, reading: Partial<QAnswerRequest>) {
  const run = randomUUID();
  const { alpha, gateway } = gatewayWith();
  const { repositories, completed } = repositoriesFor(asked, run);
  const tools: QToolPort = {
    offer: () =>
      Promise.resolve([
        offered("find_prospective_investors", "investor.prospects"),
        offered("list_incoming_interest", "investor.interest.incoming"),
      ]),
    execute: (proposal) => {
      if (proposal.name === "find_prospective_investors") {
        return Promise.resolve(
          ok(proposal, "investor.prospects", {
            fitVersion: "prospect-fit.v2",
            companySource: "CAPITAL_Q_RECORD",
            compared: { countryCode: "NG", stageCode: "seed" },
            prospects: PROSPECTS,
            notes: [],
          }),
        );
      }
      if (proposal.name === "list_incoming_interest") {
        // Zino approached them and they accepted (in diligence since).
        return Promise.resolve(
          ok(proposal, "investor.interest.incoming", {
            interests: [
              {
                investorOrganisationId: ZINO,
                investorName: "Zino Aviation",
                investorType: "VC",
                expressedAt: "2026-11-10T09:00:00.000Z",
                answer: "ACCEPTED",
              },
            ],
          }),
        );
      }
      return Promise.resolve(ok(proposal, "unused", null));
    },
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => Promise.resolve(digestOf("COMPANY", [ZINO])),
    ownCompanySnapshot: () =>
      Promise.resolve({
        companyId: COMPANY,
        name: "Nixo",
        shortDescription: "Payments for pharmacies.",
        stageCode: "seed",
        countryCode: "NG",
      }),
  });
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    turnKind: "QUESTION_TO_Q",
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: { route: "HOME" },
      scopes: [{ kind: "OWN_Q_CONVERSATION" }],
      denied: [],
      maxSensitivity: "PUBLIC",
    },
    ...reading,
  } as unknown as QAnswerRequest;
  return { seam, request, completed, alpha };
}

describe("RC2 founder lane (P0): investor prospects honour the stated condition", () => {
  it("F7-13 'leave out companies I'm already talking to': Zino is never named, and the exclusion is said", async () => {
    const asked =
      "Find my strongest opportunities and leave out companies I'm already talking to";
    const { seam, request, completed, alpha } = founderTurn(asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: asked, count: null },
      excludeRelationships: true,
      listConditions: { ...NO_CONDITIONS, relationship: "EXCLUDE_IN_CONTACT" },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    const text = completed.at(-1)?.message.text ?? "";
    const cards = cardsOf(completed);
    expect(cards).not.toContain("Zino Aviation");
    expect(text).not.toContain("Zino");
    expect(text).toMatch(
      /^Leaving out the investor you're already talking to\./u,
    );
    expect(cards.length).toBeGreaterThan(0);
  });

  it("the same exclusion read only by v88 (founder FIT, no listConditions) still leaves Zino out", async () => {
    const asked =
      "which investors fit, leaving out ones I'm already talking to";
    const { seam, request, completed } = founderTurn(asked, {
      questionKind: "FIT",
      fitQuestion: { text: asked, count: null },
      excludeRelationships: true,
    });
    await seam.answer(request);
    expect(cardsOf(completed)).not.toContain("Zino Aviation");
    expect(completed.at(-1)?.message.text ?? "").not.toContain("Zino");
  });

  it("F7-09 'which would be poor fits' lists only investors whose published criteria miss, poorest first", async () => {
    const asked =
      "Which ones would be poor fits even if they have a lot of money";
    const { seam, request, completed, alpha } = founderTurn(asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: asked, count: null },
      listConditions: { ...NO_CONDITIONS, order: "WORST_FIRST" },
    });
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    const cards = cardsOf(completed);
    expect(cards).toEqual([
      "Cape Meridian Growth (fictional)",
      "Baobab Capital (fictional)",
    ]);
    const text = completed.at(-1)?.message.text ?? "";
    expect(text).toMatch(/^Poor fits on what they publish, poorest first/u);
    expect(text).not.toMatch(/Talk to .* first/u);
    expect(text).toContain(
      "Chidi Nwosu Angel Investments (fictional) doesn't publish enough to tell either way.",
    );
    expect(completed.at(-1)?.message.blocks?.[0]?.title).toBe(
      "Poor fits on what they publish",
    );
  });

  it("a sector condition keeps only matching investors and never treats unknown as a mismatch", async () => {
    const asked = "investors who don't usually back my sector";
    const { seam, request, completed } = founderTurn(asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: asked, count: null },
      listConditions: { ...NO_CONDITIONS, sector: "OUTSIDE" },
    });
    await seam.answer(request);
    expect(cardsOf(completed)).toEqual(["Baobab Capital (fictional)"]);
    expect(completed.at(-1)?.message.text ?? "").toContain(
      "Chidi Nwosu Angel Investments (fictional)",
    );
  });

  it("a revenue condition cannot apply to investors: the full path answers, never the shortlist", async () => {
    const asked = "which investors only back companies with revenue";
    const { seam, request, completed, alpha } = founderTurn(asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: asked, count: null },
      listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
    });
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
    expect(completed.at(-1)?.message.text ?? "").not.toMatch(
      /^Talk to Zino Aviation/u,
    );
  });

  it("with no condition, the plain prospects answer is unchanged (Zino, already interested, first)", async () => {
    const asked =
      "can you find investors whose mandate appears suitable for me";
    const { seam, request, completed } = founderTurn(asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: asked, count: null },
    });
    await seam.answer(request);
    expect(completed.at(-1)?.message.text ?? "").toMatch(
      /^Talk to Zino Aviation/u,
    );
  });
});

// ---------------------------------------------------------------------
// Live re-check of 651a3bd50 (15 Nov 2026): T2, T3 and T7, each replayed
// as a conversation through the same answer seam q-api composes.
// ---------------------------------------------------------------------

/** One conversation: every turn sees the turns (and cards) before it. */
function conversationSeam(input: {
  readonly execute: QToolPort["execute"];
  readonly offered: readonly (readonly [string, string])[];
  readonly digest: QAccountDigest;
  readonly investor: boolean;
}) {
  const conversationId = randomUUID();
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [ANALYST, ANALYST, ANALYST, ANALYST],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages: QConversationMessage[] = [];
  const completed: Completed[] = [];
  const executed: string[] = [];
  const message = (
    run: string,
    role: "USER" | "Q",
    content: string,
    blocks?: unknown,
  ): QConversationMessage =>
    ({
      id: randomUUID(),
      tenantId: TENANT,
      conversationId,
      runId: run,
      role,
      content,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
      ...(blocks === undefined ? {} : { blocks }),
    }) as never;
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        row: { runId: string; content: string; blocks?: unknown },
      ) => {
        const stored = message(row.runId, "Q", row.content, row.blocks);
        messages.push(stored);
        return Promise.resolve(stored);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: {
      append: (
        _tx: unknown,
        event: { eventType?: string; payload?: unknown },
      ) => {
        if (event.eventType === "q.message.completed") {
          completed.push(event.payload as Completed);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const tools: QToolPort = {
    offer: () =>
      Promise.resolve(input.offered.map(([name, tool]) => offered(name, tool))),
    execute: (proposal, context) => {
      executed.push(proposal.name);
      return input.execute(proposal, context);
    },
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => Promise.resolve(input.digest),
    ...(input.investor
      ? {}
      : {
          ownCompanySnapshot: () =>
            Promise.resolve({
              companyId: COMPANY,
              name: "Nixo",
              shortDescription: "Payments for pharmacies.",
              stageCode: "seed",
              countryCode: "NG",
            }),
        }),
  });
  const investorOrganisationId = randomUUID();
  const turn = async (
    asked: string,
    reading: Partial<QAnswerRequest>,
    priorQ?: { readonly content: string; readonly blocks: unknown },
    options: { readonly warm?: boolean } = {},
  ) => {
    const run = randomUUID();
    if (priorQ !== undefined) {
      messages.push(message(randomUUID(), "Q", priorQ.content, priorQ.blocks));
    }
    messages.push(message(run, "USER", asked));
    const now = new Date();
    const plan = input.investor
      ? PermittedContextPlanSchema.parse({
          contractVersion: 1,
          policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
          planId: randomUUID(),
          fingerprint: "0".repeat(64),
          runId: run,
          tenantId: TENANT,
          actor: { userId: USER },
          purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
          subjects: [],
          scopes: [
            {
              kind: "INVESTOR_MANDATE",
              contextLabel: "investor_private",
              sensitivity: "CONFIDENTIAL",
              layer: "STRUCTURED_STATE",
              factCategories: ["INVESTOR_THESIS"],
              projection: "FULL",
              rights: {
                canUseForReasoning: true,
                canDiscloseExistence: true,
                canQuote: true,
                canProvideLink: false,
              },
              filter: { tenantId: TENANT, investorOrganisationId },
              isEvidence: true,
              subject: {
                kind: "INVESTOR_ORGANISATION",
                investorOrganisationId,
              },
            },
          ],
          denied: [],
          maxSensitivity: "CONFIDENTIAL",
          allowedLayers: [],
          combinationConstraints: [],
          evaluatedAt: now.toISOString(),
          revalidateAfter: new Date(now.getTime() + 60_000).toISOString(),
          revalidateOnResume: true,
        })
      : {
          runId: run,
          tenantId: TENANT,
          actor: { userId: USER },
          purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
          subjects: [],
          screen: { route: "HOME" },
          scopes: [{ kind: "OWN_Q_CONVERSATION" }],
          denied: [],
          maxSensitivity: "PUBLIC",
        };
    const executedBefore = executed.length;
    const callsBefore = alpha.calls.length;
    const unread = {
      runId: run,
      tenantId: TENANT,
      actorUserId: USER,
      actor: ActorContextSchema.parse({
        userId: USER,
        tenantId: TENANT,
        actorType: "HUMAN",
      }),
      correlationId: `cor_${run}`,
      capability: "ANSWER",
      subjects: [],
      retrieval: { kind: "NOT_CONFIGURED" },
      plan,
    } as unknown as QAnswerRequest;
    const request = {
      ...unread,
      turnKind: "QUESTION_TO_Q",
      ...reading,
    } as QAnswerRequest;
    // As q-api composes it: the specialist warms the gateway's prepare
    // with the turn as it arrives, beside the turn reader.
    if (options.warm === true) seam.warm?.(unread);
    const outcome = await seam.answer(request);
    // Whatever the warm-up started lands before the turn is counted.
    for (let at = 0; at < 20; at += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      outcome,
      text: completed.at(-1)?.message.text ?? "",
      cards: cardsOf(completed),
      tools: executed.slice(executedBefore),
      modelCalls: alpha.calls.slice(callsBefore),
    };
  };
  return { turn };
}

const INVESTOR_TOOLS: readonly (readonly [string, string])[] = [
  ["discover_companies", "discovery.companies"],
  ["fit_top_candidates", "fit.top_candidates"],
  ["fit_profile", "fit.profile"],
  ["read_company_figures", "company.figures.read"],
  ["list_my_relationships", "relationship.list_mine"],
];

/** Q's earlier mandate ranking, as the cards it stored with its turn. */
function shownRanking(companies: readonly Company[]) {
  return {
    content: `Ranked by fit with your mandate: ${companies.map((one) => one.name).join(", ")}.`,
    blocks: [
      {
        kind: "ANSWER_CARDS",
        shape: "RANKED",
        title: "Fit against your mandate",
        cards: companies.map((one, at) => ({
          key: `c${String(at)}`,
          name: one.name,
          line: null,
          hue: 0,
          fit: { score: 9 - at, measured: 9, of: 9 },
          reasons: [
            `${one.name} matches your seed stage and a preferred sector`,
          ],
          measures: [],
          subject: { kind: "COMPANY", companyId: one.id },
        })),
        followUps: [],
      },
    ],
  };
}

describe("live re-check T2: a condition that rules out everything shown looks wider", () => {
  it("'the weakest fits outside my sectors' after an in-sector ranking widens to the catalog, and says so", async () => {
    const { turn } = conversationSeam({
      execute: investorExecute,
      offered: INVESTOR_TOOLS,
      digest: digestOf("INVESTOR", []),
      investor: true,
    });
    const asked = "Now show me the weakest fits that sit outside my sectors";
    const t2 = await turn(
      asked,
      {
        questionKind: "FIT",
        fitQuestion: { text: asked, count: null, previous: true },
        listConditions: {
          ...NO_CONDITIONS,
          sector: "OUTSIDE",
          order: "WORST_FIRST",
        },
      },
      shownRanking(named(["Nixo", "Halyard Security"])),
    );
    expect(t2.modelCalls).toHaveLength(0);
    // Never "none exist" from the two shown alone.
    expect(t2.text).toMatch(
      /^None of the two companies I just showed are outside your preferred sectors, so I looked wider\./u,
    );
    expect(t2.cards.sort()).toEqual(["Shiftwell", "Tensorgate"]);
    for (const company of named(t2.cards)) {
      expect(company.sector).toBe("MISMATCH");
    }
    expect(t2.text).toContain("weakest first");
    // Unknown sector is named as unknown, never shown as outside.
    expect(t2.cards).not.toContain("Clearwater Assurance");
  });
});

describe("live re-check T7: conditions stated in the conversation carry to the follow-up", () => {
  it("founder: 'And the ones that fit badly?' keeps 'skip the ones I'm already in conversation with'", async () => {
    // In conversation with Zino and Chidi (the account digest).
    const execute: QToolPort["execute"] = (proposal) => {
      if (proposal.name === "find_prospective_investors") {
        return Promise.resolve(
          ok(proposal, "investor.prospects", {
            fitVersion: "prospect-fit.v2",
            companySource: "CAPITAL_Q_RECORD",
            compared: { countryCode: "NG", stageCode: "seed" },
            prospects: PROSPECTS,
            notes: [],
          }),
        );
      }
      if (proposal.name === "list_incoming_interest") {
        return Promise.resolve(
          ok(proposal, "investor.interest.incoming", { interests: [] }),
        );
      }
      return Promise.resolve(ok(proposal, "unused", null));
    };
    const { turn } = conversationSeam({
      execute,
      offered: [
        ["find_prospective_investors", "investor.prospects"],
        ["list_incoming_interest", "investor.interest.incoming"],
      ],
      digest: digestOf("COMPANY", [ZINO, CHIDI]),
      investor: false,
    });
    const t6Asked =
      "Which investors are a good fit for us, but skip the ones I'm already in conversation with?";
    const t6 = await turn(t6Asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: t6Asked, count: null },
      excludeRelationships: true,
      listConditions: { ...NO_CONDITIONS, relationship: "EXCLUDE_IN_CONTACT" },
    });
    expect(t6.text).not.toContain("Zino");
    expect(t6.text).not.toContain("Chidi");
    const t7Asked = "And the ones that fit badly?";
    const t7 = await turn(t7Asked, {
      questionKind: "INVESTOR_PROSPECTS",
      investorProspects: { text: t7Asked, count: null },
      executionClass: "CONTEXTUAL_FOLLOW_UP",
      // The reading carries the order only; the exclusion is not restated.
      listConditions: { ...NO_CONDITIONS, order: "WORST_FIRST" },
    });
    expect(t7.modelCalls).toHaveLength(0);
    // Chidi, whom they are talking to, is never named -- not even as unknown.
    expect(t7.text).not.toContain("Chidi");
    expect(t7.cards).not.toContain("Chidi Nwosu Angel Investments (fictional)");
    expect(t7.text).toMatch(/already talking to/u);
    expect(t7.cards).toEqual([
      "Cape Meridian Growth (fictional)",
      "Baobab Capital (fictional)",
    ]);
  });

  it("a condition the follow-up states replaces the carried one", async () => {
    const { turn } = conversationSeam({
      execute: investorExecute,
      offered: INVESTOR_TOOLS,
      digest: digestOf("INVESTOR", []),
      investor: true,
    });
    const said = "only the ones with actual revenue";
    const t1 = await turn(said, {
      questionKind: "FIT",
      fitQuestion: { text: said, count: null },
      listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
    });
    expect(t1.cards.sort()).toEqual(
      ["Clearwater Assurance", "Nixo", "Shiftwell"].sort(),
    );
    const t2 = await turn("and the pre-revenue ones?", {
      questionKind: "FIT",
      fitQuestion: { text: "and the pre-revenue ones?", count: null },
      listConditions: { ...NO_CONDITIONS, revenue: "PRE_REVENUE" },
    });
    expect(t2.cards.sort()).toEqual(["Tangible", "Tensorgate"]);
  });
});

describe("live re-check T3: 'Why the first one?' is answered from the card Q showed", () => {
  it("one answer call and no tool round when the card covers the company", async () => {
    const { turn } = conversationSeam({
      execute: investorExecute,
      offered: [
        ...INVESTOR_TOOLS,
        ["get_company", "company.get"],
        ["get_relationship", "relationship.get"],
        ["list_schedule", "schedule.list"],
        ["list_pending_approvals", "approvals.pending.list"],
        ["list_q_work", "q.work.list"],
      ],
      digest: digestOf("INVESTOR", []),
      investor: true,
    });
    const shown = shownRanking(named(["Nixo", "Halyard Security"]));
    const t3 = await turn(
      "Why the first one?",
      {
        executionClass: "CONTEXTUAL_FOLLOW_UP",
        references: ` "the first one" = Nixo (company ${CO(1)})`,
        followUpCompanyId: CO(1),
      },
      shown,
    );
    expect(t3.outcome.kind).toBe("ANSWERED");
    // Reader + one answer call: here (after the reader), the one answer call.
    expect(t3.modelCalls).toHaveLength(1);
    expect(t3.tools.length).toBeLessThanOrEqual(2);
    for (const name of [
      "list_schedule",
      "list_pending_approvals",
      "list_q_work",
      "get_relationship",
      "fit_profile",
    ]) {
      expect(t3.tools).not.toContain(name);
    }
    // The card Q showed is what the answer is written from.
    expect(JSON.stringify(t3.modelCalls[0])).toContain(
      "Nixo matches your seed stage",
    );
  });
});

/**
 * Live re-check of 3b7145616 (16 Nov 2026), turns A-C: "Among my
 * top-ranked companies, which have real revenue coming in?", "Then the
 * worst fits outside the sectors I invest in", "Why is the first one
 * there?" -- the third ran 8 reads, a public-web search and two model
 * calls. The conditioned list's cards are shown cards like a fit list's:
 * the follow-up is answered from the card and the list's stated
 * conditions and order, with no web search, even when research was read
 * EXPLICIT.
 */
describe("live re-check 3b7145616: a follow-up on a conditioned list is answered from its card", () => {
  it("one answer call, no web search, and the list's own conditions and order as evidence", async () => {
    const { turn } = conversationSeam({
      execute: (proposal, context) =>
        proposal.name === "research_public_web"
          ? Promise.resolve(
              ok(proposal, "public_web.search", { status: "OK", sources: [] }),
            )
          : investorExecute(proposal, context),
      offered: [
        ...INVESTOR_TOOLS,
        ["get_company", "company.get"],
        ["get_relationship", "relationship.get"],
        ["list_schedule", "schedule.list"],
        ["list_pending_approvals", "approvals.pending.list"],
        ["list_q_work", "q.work.list"],
        ["search_companies", "company.search"],
        ["research_public_web", "public_web.search"],
      ],
      digest: digestOf("INVESTOR", []),
      investor: true,
    });
    const aAsked =
      "Among my top-ranked companies, which have real revenue coming in?";
    await turn(aAsked, {
      questionKind: "FIT",
      fitQuestion: { text: aAsked, count: null },
      listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
    });
    const bAsked = "Then the worst fits outside the sectors I invest in";
    const b = await turn(bAsked, {
      questionKind: "FIT",
      fitQuestion: { text: bAsked, count: null },
      listConditions: {
        ...NO_CONDITIONS,
        sector: "OUTSIDE",
        order: "WORST_FIRST",
      },
    });
    const first = /weakest first: ([A-Z][A-Za-z ]+?) at /u.exec(b.text)?.[1];
    const company = COMPANIES.find((one) => one.name === first);
    expect(company).toBeDefined();
    const c = await turn("Why is the first one there?", {
      executionClass: "CONTEXTUAL_FOLLOW_UP",
      followUpCompanyId: company?.id,
      aboutNamedOther: true,
      namedOther: { kind: "COMPANY", name: company?.name ?? "" },
      research: Promise.resolve({
        mode: "EXPLICIT",
        announceSourceChange: false,
      }),
    });
    expect(c.outcome.kind).toBe("ANSWERED");
    expect(c.modelCalls).toHaveLength(1);
    expect(c.tools).not.toContain("research_public_web");
    expect(c.tools.length).toBeLessThanOrEqual(2);
    const evidence = JSON.stringify(c.modelCalls[0]);
    // The list as Q said it: its conditions and its order.
    expect(evidence).toContain(`weakest first: ${company?.name ?? "-"}`);
    expect(evidence).toContain("outside your preferred sectors");
  });
});

/**
 * Live re-check of 9913a5b64 (16 Nov 2026), turns A-C: "Of the companies
 * that fit me best, which are already earning revenue?", "Now the weakest
 * ones outside my sectors" (one company, revenue carried, worst first),
 * "Why is that one at the top?". Routed CONTEXTUAL_FOLLOW_UP with research
 * NEVER, yet seven reads ran (their day, their relationships, a company
 * search, the company and its relationship): the gateway's warm-up, which
 * starts beside the turn reader, took "the top" for a company name typed
 * in lowercase and started the wide reads before the reading said the
 * turn is about a card Q showed.
 */
describe("live re-check 9913a5b64: 'that one' on a one-company conditioned list is answered from its card", () => {
  const followUps = [
    "Why is that one at the top?",
    "Why is it there?",
    "Why is the first one there?",
    // The fixture's one outside-sector company with revenue, named.
    "Why is Shiftwell at the top?",
  ];
  for (const asked of followUps) {
    it(`"${asked}": one answer call, at most two reads, no web`, async () => {
      const { turn } = conversationSeam({
        execute: (proposal, context) =>
          proposal.name === "research_public_web"
            ? Promise.resolve(
                ok(proposal, "public_web.search", {
                  status: "OK",
                  sources: [],
                }),
              )
            : investorExecute(proposal, context),
        offered: [
          ...INVESTOR_TOOLS,
          ["get_company", "company.get"],
          ["get_relationship", "relationship.get"],
          ["list_schedule", "schedule.list"],
          ["list_pending_approvals", "approvals.pending.list"],
          ["list_q_work", "q.work.list"],
          ["search_companies", "company.search"],
          ["research_public_web", "public_web.search"],
        ],
        digest: digestOf("INVESTOR", []),
        investor: true,
      });
      const aAsked =
        "Of the companies that fit me best, which are already earning revenue?";
      await turn(
        aAsked,
        {
          questionKind: "FIT",
          fitQuestion: { text: aAsked, count: null },
          listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
        },
        undefined,
        { warm: true },
      );
      const bAsked = "Now the weakest ones outside my sectors";
      const b = await turn(
        bAsked,
        {
          questionKind: "FIT",
          fitQuestion: { text: bAsked, count: null },
          listConditions: {
            ...NO_CONDITIONS,
            sector: "OUTSIDE",
            order: "WORST_FIRST",
          },
        },
        undefined,
        { warm: true },
      );
      // One company on the list, as live.
      expect(b.cards).toHaveLength(1);
      const company = COMPANIES.find((one) => one.name === b.cards[0]);
      expect(company).toBeDefined();
      const c = await turn(
        asked,
        {
          executionClass: "CONTEXTUAL_FOLLOW_UP",
          followUpCompanyId: company?.id,
          research: Promise.resolve({
            mode: "NEVER",
            announceSourceChange: false,
          }),
        },
        undefined,
        { warm: true },
      );
      expect(c.outcome.kind).toBe("ANSWERED");
      expect(c.modelCalls).toHaveLength(1);
      expect(c.tools).not.toContain("research_public_web");
      expect(c.tools.length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(c.modelCalls[0])).toContain(
        `weakest first: ${company?.name ?? "-"}`,
      );
    });
  }
});

/**
 * Live re-check of cb28c00e5 (16 Nov 2026), turn D: "And why is MedTrail
 * ranked first in the earlier list?" -- a card of the list before the
 * latest one. 31 tools and 8 model calls: the warm-up took the name for a
 * company beyond the latest cards and started the wide reads. Shown-list
 * membership is every card Q showed in the conversation.
 */
describe("live re-check cb28c00e5: a why about a card of an earlier list is answered from that card", () => {
  for (const shape of [
    (name: string) => `And why is ${name} ranked first in the earlier list?`,
    (name: string) => `How come ${name} topped the first list?`,
  ]) {
    it(`"${shape("<first card>")}": one answer call, at most two reads, no web`, async () => {
      const { turn } = conversationSeam({
        execute: (proposal, context) =>
          proposal.name === "research_public_web"
            ? Promise.resolve(
                ok(proposal, "public_web.search", {
                  status: "OK",
                  sources: [],
                }),
              )
            : investorExecute(proposal, context),
        offered: [
          ...INVESTOR_TOOLS,
          ["get_company", "company.get"],
          ["get_relationship", "relationship.get"],
          ["list_schedule", "schedule.list"],
          ["list_pending_approvals", "approvals.pending.list"],
          ["list_q_work", "q.work.list"],
          ["search_companies", "company.search"],
          ["research_public_web", "public_web.search"],
        ],
        digest: digestOf("INVESTOR", []),
        investor: true,
      });
      const aAsked = "Which of my best matches have revenue on record?";
      const a = await turn(
        aAsked,
        {
          questionKind: "FIT",
          fitQuestion: { text: aAsked, count: null },
          listConditions: { ...NO_CONDITIONS, revenue: "HAS_REVENUE" },
        },
        undefined,
        { warm: true },
      );
      const bAsked = "Show the weakest of those outside my sectors";
      const b = await turn(
        bAsked,
        {
          questionKind: "FIT",
          fitQuestion: { text: bAsked, count: null },
          listConditions: {
            ...NO_CONDITIONS,
            sector: "OUTSIDE",
            order: "WORST_FIRST",
          },
        },
        undefined,
        { warm: true },
      );
      const first = COMPANIES.find((one) => one.name === a.cards[0]);
      expect(first).toBeDefined();
      expect(b.cards).not.toContain(first?.name);
      const d = await turn(
        shape(first?.name ?? "-"),
        {
          executionClass: "CONTEXTUAL_FOLLOW_UP",
          followUpCompanyId: first?.id,
          research: Promise.resolve({
            mode: "NEVER",
            announceSourceChange: false,
          }),
        },
        undefined,
        { warm: true },
      );
      expect(d.outcome.kind).toBe("ANSWERED");
      expect(d.modelCalls).toHaveLength(1);
      expect(d.tools).not.toContain("research_public_web");
      expect(d.tools.length).toBeLessThanOrEqual(2);
      // The earlier list's own conditions go with its card.
      expect(JSON.stringify(d.modelCalls[0])).toContain("revenue on record");
    });
  }
});

// Live re-check of 3b7145616: "one has revenue on record and are outside
// your preferred sectors" -- only the first predicate agreed with one.
describe("conditioned-list sentence agreement", () => {
  it("every predicate agrees with a count of one", () => {
    expect(
      predicate(
        conditionWords(
          { ...NO_CONDITIONS, revenue: "HAS_REVENUE", sector: "OUTSIDE" },
          "INVESTOR",
        ),
        true,
      ),
    ).toBe("has revenue on record and is outside your preferred sectors");
    expect(
      predicate(
        conditionWords(
          { ...NO_CONDITIONS, sector: "INSIDE", geography: "OUTSIDE" },
          "FOUNDER",
        ),
        true,
      ),
    ).toBe(
      "publishes a sector that matches your company and doesn't publish your geography",
    );
    expect(
      predicate(
        conditionWords(
          { ...NO_CONDITIONS, revenue: "HAS_REVENUE", sector: "OUTSIDE" },
          "INVESTOR",
        ),
        false,
      ),
    ).toBe("have revenue on record and are outside your preferred sectors");
  });
});
