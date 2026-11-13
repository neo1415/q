import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan, QResultBlock } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QChartIntent,
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
import { RunRead } from "../src/q/card-subjects.js";
import { figureChartBlock } from "../src/q/figure-chart.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * A8 semantic equivalence (owner directive 13 Nov 2026: Q must not
 * degenerate into keyword routing). The READER OUTPUT is the fixture: the
 * turn reader reads meaning in one pass (TURN_READER v82 `chart`), and the
 * answer resolves, validates and draws from that typed intent alone. So
 * every phrasing that carries the same intent -- with or without the word
 * "chart", spoken, or in another language -- yields the same chart, and
 * company names made of ordinary words are found by the reader's names,
 * never by capital letters. Fake model; no provider; no live call.
 */

const LEDGERLINE = "11111111-1111-4111-8111-111111111111";
const CLINICREST = "22222222-2222-4222-8222-222222222222";
const OPEN_FIELD = "33333333-3333-4333-8333-333333333333";
const GROW_BANK = "44444444-4444-4444-8444-444444444444";
const KESTREL_A = "55555555-5555-4555-8555-555555555555";
const KESTREL_B = "66666666-6666-4666-8666-666666666666";
const HUSHWELL = "77777777-7777-4777-8777-777777777777";

const NAMES: Readonly<Record<string, string>> = {
  [LEDGERLINE]: "Ledgerline",
  [CLINICREST]: "Clinicrest",
  [OPEN_FIELD]: "Open Field Analytics",
  [GROW_BANK]: "Grow Bank",
  [KESTREL_A]: "Kestrel",
  [KESTREL_B]: "Kestrel",
  [HUSHWELL]: "Hushwell",
};

type Figure = {
  readonly key: string;
  readonly kind: "MONEY" | "COUNT" | "PERCENT";
  readonly points: readonly (readonly [string, string | number])[];
};

const money = (key: string, points: Figure["points"]): Figure => ({
  key,
  kind: "MONEY",
  points,
});

const FIGURES: Readonly<Record<string, readonly Figure[]>> = {
  [LEDGERLINE]: [
    money("financial.mrr", [
      ["2026-06-30", "30000"],
      ["2026-07-31", "34000"],
      ["2026-08-31", "38000"],
      ["2026-09-30", "42000"],
    ]),
    money("financial.arr", [
      ["2026-03-31", "300000"],
      ["2026-09-30", "480000"],
    ]),
    {
      key: "traction.active_users",
      kind: "COUNT",
      points: [
        ["2026-06-30", 1200],
        ["2026-09-30", 2100],
      ],
    },
    {
      key: "traction.logo_retention_6m_pct",
      kind: "PERCENT",
      points: [
        ["2026-06-30", 88],
        ["2026-09-30", 91],
      ],
    },
  ],
  [CLINICREST]: [
    money("financial.mrr", [
      ["2026-06-30", "9000"],
      ["2026-07-31", "9500"],
      ["2026-08-31", "11000"],
      ["2026-09-30", "12500"],
    ]),
  ],
  [OPEN_FIELD]: [
    money("financial.arr", [
      ["2026-03-31", "120000"],
      ["2026-09-30", "210000"],
    ]),
  ],
  [GROW_BANK]: [
    money("financial.arr", [
      ["2026-03-31", "900000"],
      ["2026-09-30", "1100000"],
    ]),
  ],
  [KESTREL_A]: [],
  [KESTREL_B]: [],
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
  visibleStage: "REVIEWING_COMPANY",
});

const OFFERED = [
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
];

const base = {
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "INTERNAL",
  latencyMs: 1,
} as const;

function outcome(proposal: QToolProposal): Omit<QToolCallOutcome, "callId"> {
  const args = proposal.arguments as Record<string, unknown>;
  if (proposal.name === "search_companies") {
    const query = String(args["query"]).toLowerCase();
    return {
      ...base,
      toolName: "company.search",
      result: {
        ok: true,
        data: {
          items: Object.entries(NAMES)
            .filter(([, name]) => name.toLowerCase().includes(query))
            .map(([companyId, canonicalName]) => ({
              companyId,
              canonicalName,
            })),
        },
      },
    } as unknown as Omit<QToolCallOutcome, "callId">;
  }
  const companyId = String(args["companyId"]);
  if (proposal.name === "read_company_figures") {
    // Hushwell's figures are founder-private: nothing is admitted to this
    // investor, so the read comes back with none (the firewall's outcome).
    const figures = (FIGURES[companyId] ?? []).flatMap((figure) =>
      figure.points.map(([asOf, value]) => ({
        key: figure.key,
        statement: `A sentence about ${figure.key} with 999,999 in it.`,
        value:
          figure.kind === "MONEY"
            ? { kind: "MONEY", amount: String(value), currency: "USD", asOf }
            : { kind: figure.kind, value, asOf },
        asOf,
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        lifecycleStatus: "CURRENT",
      })),
    );
    return {
      ...base,
      toolName: "company.figures.read",
      result: {
        ok: true,
        data: {
          companyId,
          status: figures.length === 0 ? "NONE" : "AVAILABLE",
          figures,
        },
      },
    } as unknown as Omit<QToolCallOutcome, "callId">;
  }
  return {
    ...base,
    toolName: "company.get",
    result: {
      ok: true,
      data: {
        companyId,
        canonicalName: NAMES[companyId] ?? "?",
        legalName: null,
        websiteUrl: null,
        foundedDate: null,
        headquartersCountry: "NG",
        headquartersCity: "Lagos",
        currentStageCode: "SEED",
        shortDescription: "A company.",
        primaryDescription: null,
        companyStatus: "active",
        relationToYou: "SHARED",
        truthClass: "USER_CLAIM",
      },
    },
  } as unknown as Omit<QToolCallOutcome, "callId">;
}

const ANSWER = "Here is what Capital Q holds.";

function build(
  said: string,
  reading: Readonly<Record<string, unknown>>,
  earlier: readonly {
    role: "USER" | "Q";
    content: string;
    blocks?: readonly QResultBlock[];
  }[] = [],
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer: ANSWER,
          responseShape: "CONCISE",
          findings: [],
          missingEvidence: [],
          contradictions: [],
          insufficientEvidence: false,
          recommendation: null,
          clarifyingQuestions: [],
          declined: false,
        },
      },
    ],
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
  const run = randomUUID();
  const conversation = randomUUID();
  const at = new Date().toISOString();
  const message = (
    role: "USER" | "Q",
    content: string,
    runId: string,
    blocks?: readonly QResultBlock[],
  ) => ({
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: conversation,
    runId,
    role,
    content,
    contentType: "TEXT",
    ...(blocks === undefined ? {} : { blocks }),
    createdAt: at,
  });
  const messages = [
    ...earlier.map((one) =>
      message(one.role, one.content, randomUUID(), one.blocks),
    ),
    message("USER", said, run),
  ] as unknown as QConversationMessage[];
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const executed: QToolProposal[] = [];
  const stored: { content: string; blocks?: readonly unknown[] }[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve({
        callId: proposal.callId,
        ...outcome(proposal),
      } as QToolCallOutcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { content: string; blocks?: readonly unknown[] },
      ) => {
        stored.push(input);
        return Promise.resolve({
          ...messages.at(-1),
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    ...reading,
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: { route: "HOME" },
      scopes: [
        { kind: "OWN_Q_CONVERSATION" },
        {
          kind: "INVESTOR_MANDATE",
          subject: {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: "1c4b9266-350c-409d-9582-04a0f771b8a8",
          },
        },
      ],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, stored };
}

const intent = (chart: Partial<QChartIntent>): Record<string, unknown> => ({
  asksForChart: true,
  chartIntent: {
    companies: [],
    metric: "UNSPECIFIED",
    period: null,
    sameAsBefore: false,
    ...chart,
  },
});

type Chart = {
  kind: "CHART";
  chart: string;
  title: string;
  currency: string | null;
  series: { label: string; points: { label: string; value: number }[] }[];
};
const chartsOf = (blocks: readonly unknown[] | undefined): Chart[] =>
  (blocks ?? []).filter(
    (block) => Reflect.get(block as object, "kind") === "CHART",
  ) as Chart[];

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

const searched = (executed: readonly QToolProposal[]) =>
  executed
    .filter((call) => call.callId.startsWith("q-chart-search-"))
    .map((call) => Reflect.get(call.arguments as object, "query") as unknown);

async function answered(
  said: string,
  reading: Readonly<Record<string, unknown>>,
  earlier?: Parameters<typeof build>[2],
) {
  const built = build(said, reading, earlier);
  expect((await built.seam.answer(built.request)).kind).toBe("ANSWERED");
  const last = built.stored.at(-1);
  return {
    ...built,
    charts: chartsOf(last?.blocks),
    content: last?.content ?? "",
  };
}

describe("one typed intent, one chart, however it was said", () => {
  // Every phrasing below was read (by the reader, in one pass) as the same
  // intent; the answer never looks at the words to decide the chart.
  const LEDGERLINE_MRR = intent({ companies: ["Ledgerline"], metric: "MRR" });
  const PARAPHRASES = [
    "Chart Ledgerline's monthly recurring revenue over the last few months.",
    "How has Ledgerline's MRR moved recently?",
    "Can I see Ledgerline's MRR trend?",
    "uh can you like pull up how ledgerline's mrr has been doing, visually",
    "Show me Ledgerline MRR over time",
    "Plot ledgerline mrr",
    "I'd like a picture of Ledgerline's recurring revenue month by month.",
    "Montre-moi l'évolution du MRR de Ledgerline.",
    "Muéstrame cómo ha evolucionado el MRR de Ledgerline.",
  ];

  it("all nine paraphrases yield the identical Ledgerline MRR line", async () => {
    const results = await Promise.all(
      PARAPHRASES.map((said) => answered(said, LEDGERLINE_MRR)),
    );
    const first = results[0]?.charts[0];
    expect(first?.chart).toBe("LINE");
    expect(first?.title).toBe("Ledgerline: monthly recurring revenue");
    expect(first?.series[0]?.points.map((point) => point.value)).toEqual([
      30000, 34000, 38000, 42000,
    ]);
    for (const result of results) {
      expect(result.charts).toEqual([first]);
      // Looked up by the reader's name, never by the words around it.
      expect(searched(result.executed)).toEqual(["Ledgerline"]);
      expect(sentTo(result.alpha)).toContain("Shown on screen now");
    }
  });

  it("the same words without a chart intent draw nothing and suggest nothing", async () => {
    for (const said of [
      "What's Ledgerline's MRR?",
      "Chart a course for our next raise.",
      "Graph theory aside, who leads Ledgerline?",
    ]) {
      const result = await answered(said, {
        answerKind: "LOOKUP",
      });
      expect(result.charts).toEqual([]);
      expect(searched(result.executed)).toEqual([]);
      expect(result.content).not.toMatch(/\bchart\b/iu);
      expect(sentTo(result.alpha)).not.toContain("They asked for a chart");
    }
  });
});

describe("names come from the reader, not from capital letters", () => {
  it("company names made of ordinary words resolve by the reader's names", async () => {
    const result = await answered(
      "put open field analytics and grow bank's arr side by side for me",
      intent({
        companies: ["Open Field Analytics", "Grow Bank"],
        metric: "ARR",
      }),
    );
    expect(searched(result.executed)).toEqual([
      "Open Field Analytics",
      "Grow Bank",
    ]);
    const [chart] = result.charts;
    expect(chart?.chart).toBe("LINE");
    expect(chart?.series.map((series) => series.label)).toEqual([
      "Open Field Analytics",
      "Grow Bank",
    ]);
  });

  it("a name two companies fit draws nothing and asks which, naming both", async () => {
    const result = await answered(
      "Chart Kestrel's revenue",
      intent({ companies: ["Kestrel"], metric: "REVENUE" }),
    );
    expect(result.charts).toEqual([]);
    const sent = sentTo(result.alpha);
    expect(sent).toMatch(
      /more than one company on Capital Q has that name: Kestrel and Kestrel/u,
    );
    expect(sent).toContain("Ask them, in one line, which one they mean.");
    // No figures are read for a guess.
    expect(
      result.executed.filter((call) => call.name === "read_company_figures"),
    ).toEqual([]);
  });
});

describe("the metric is the reader's; code validates it and never swaps it", () => {
  const cases = [
    ["MRR", "Ledgerline: monthly recurring revenue"],
    ["ARR", "Ledgerline: annual recurring revenue"],
    ["USERS", "Ledgerline: active users"],
    ["RETENTION", "Ledgerline: logo retention 6m pct"],
  ] as const;
  for (const [metric, title] of cases) {
    it(`${metric} draws its own figure`, async () => {
      const result = await answered(
        "Show me how that's moved",
        intent({ companies: ["Ledgerline"], metric }),
      );
      expect(result.charts.map((chart) => chart.title)).toEqual([title]);
    });
  }

  it("growth with no growth claim is said to be missing, never another figure drawn", async () => {
    const result = await answered(
      "Chart Ledgerline's growth",
      intent({ companies: ["Ledgerline"], metric: "GROWTH" }),
    );
    expect(result.charts).toEqual([]);
    expect(sentTo(result.alpha)).toMatch(
      /No chart was drawn: Capital Q holds no published revenue growth figure that they may see for Ledgerline/u,
    );
  });

  it("an unspecified metric with several drawable asks which, listing them, with no revenue default", async () => {
    const result = await answered(
      "Chart Ledgerline for me",
      intent({ companies: ["Ledgerline"] }),
    );
    expect(result.charts).toEqual([]);
    const sent = sentTo(result.alpha);
    expect(sent).toContain(
      "Capital Q can chart these published figures: monthly recurring revenue (MRR), annual recurring revenue (ARR), retention and active users.",
    );
    expect(sent).toContain(
      "Ask them, in one short question, which of these to chart.",
    );
  });

  it("an unspecified metric with exactly one drawable draws it", async () => {
    const result = await answered(
      "Chart Clinicrest",
      intent({ companies: ["Clinicrest"] }),
    );
    expect(result.charts.map((chart) => chart.title)).toEqual([
      "Clinicrest: monthly recurring revenue",
    ]);
  });

  it("figures not admitted to this person (private) draw nothing, and say so", async () => {
    const result = await answered(
      "Show me Hushwell's MRR trend",
      intent({ companies: ["Hushwell"], metric: "MRR" }),
    );
    expect(result.charts).toEqual([]);
    expect(sentTo(result.alpha)).toMatch(
      /no published monthly recurring revenue \(MRR\) figure that they may see for Hushwell/u,
    );
    expect(sentTo(result.alpha)).not.toContain("999");
  });

  it("a comparison where one company lacks the metric draws nothing, not half", async () => {
    const result = await answered(
      "Ledgerline vs Grow Bank MRR, as a chart",
      intent({ companies: ["Ledgerline", "Grow Bank"], metric: "MRR" }),
    );
    expect(result.charts).toEqual([]);
    expect(sentTo(result.alpha)).toMatch(/for Grow Bank/u);
  });

  it("a period keeps only its months", async () => {
    const result = await answered(
      "How has Ledgerline's MRR moved since August?",
      intent({
        companies: ["Ledgerline"],
        metric: "MRR",
        period: { from: "2026-08", to: null },
      }),
    );
    expect(
      result.charts[0]?.series[0]?.points.map((point) => point.label),
    ).toEqual(["Aug 2026", "Sep 2026"]);
  });
});

describe("a follow-up that repeats the previous chart (sameAsBefore)", () => {
  const previous = () => {
    const run = new RunRead();
    run.companyNames.set(LEDGERLINE, "Ledgerline");
    run.companyFigures.set(
      LEDGERLINE,
      (FIGURES[LEDGERLINE]?.[0]?.points ?? []).map(([asOf, value]) => ({
        key: "financial.mrr",
        statement: "MRR.",
        asOf,
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        value: { kind: "MONEY", amount: String(value), currency: "USD", asOf },
      })),
    );
    const block = figureChartBlock({ read: run, metric: "MRR" });
    if (block === null) throw new Error("no previous chart");
    return [
      { role: "USER" as const, content: "Chart Ledgerline's MRR" },
      { role: "Q" as const, content: "Here it is.", blocks: [block] },
    ];
  };

  it("'Now do the same for Clinicrest' is Clinicrest's MRR chart (the companies named now)", async () => {
    const result = await answered(
      "Now do the same for Clinicrest",
      intent({ companies: ["Clinicrest"], sameAsBefore: true }),
      previous(),
    );
    expect(searched(result.executed)).toEqual(["Clinicrest"]);
    expect(result.charts.map((chart) => chart.title)).toEqual([
      "Clinicrest: monthly recurring revenue",
    ]);
  });

  it("'and for ARR?' keeps the previous chart's company", async () => {
    const result = await answered(
      "and for ARR?",
      intent({ metric: "ARR", sameAsBefore: true }),
      previous(),
    );
    expect(searched(result.executed)).toEqual(["Ledgerline"]);
    expect(result.charts.map((chart) => chart.title)).toEqual([
      "Ledgerline: annual recurring revenue",
    ]);
  });
});
