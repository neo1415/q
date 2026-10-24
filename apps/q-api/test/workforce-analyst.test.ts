import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { QArtifactContent } from "@capital-q/contracts";
import type {
  AnalysisCritiqueResult,
  AnalysisDocumentResult,
  JobPlanResultV8,
  ResearchFactsResult,
} from "@capital-q/q-core";
import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
} from "@capital-q/q-research";
import { boundPlan, registeredExecutors } from "@capital-q/q-orchestrator";
import { teamJobLine } from "@capital-q/q-specialists";
import { ActorContextSchema } from "@capital-q/security";

import { basisProblems } from "../src/composition/workforce/analysis.js";
import {
  workforceDeepResearch,
  type ResearchDossier,
} from "../src/composition/workforce/deep-research.js";
import {
  deliveredDocument,
  deliveryText,
} from "../src/composition/workforce/delivery.js";
import { createWorkforceDocuments } from "../src/composition/workforce/documents.js";
import { createOwnContextReader } from "../src/composition/workforce/own-context.js";
import { withWaitingPlans } from "../src/composition/workforce/waiting-plans.js";
import {
  createOwnWorkStarter,
  createWorkforceJobBoard,
  isOwnAccountWork,
  planShape,
  sameWork,
} from "../src/composition/workforce/job-actions.js";
import {
  createWorkforceJobs,
  type WorkforceDocumentInput,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import type { WorkforceModels } from "../src/composition/workforce/models.js";
import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";
import {
  MAJI_DRAFT_ONE,
  MAJI_DRAFT_TWO,
  MAJI_LOOP_REQUEST,
  MAJI_PAGES,
} from "./fixtures/maji-loop-growth-plan.js";

/**
 * Owner 2026-10-23: Q works like a real business analyst. The Maji Loop
 * request, end to end with fakes (no provider, no model, no live call):
 * the lead plans research and an ANALYSIS; own work starts with no card;
 * research is planned by meaning and run side by side; the document is
 * critiqued and REALLY revised; it lands in the conversation.
 */

const PRIVATE_MARKER = "CQ_PRIVATE_DO_NOT_EGRESS_77120";
const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

/** The plan the lead writes for the Maji Loop request (JOB_PLAN v8). */
const MAJI_PLAN: JobPlanResultV8 = {
  summary:
    "Research Kenya's water access and kiosk market, then write Maji Loop's 12-month growth plan.",
  outcome: "A shareable 12-month growth plan grounded in market evidence.",
  prerequisites: [],
  nextActions: [],
  firstRead:
    "My first view: kiosks win on price per litre and proximity, so density in a few settlements matters more than spreading thin.",
  steps: [
    {
      key: "research",
      role: "RESEARCH",
      goal: "The size and growth of Kenya's water kiosk market, who competes and at what price, the alternatives households use, regulation and unit economics.",
      tools: ["public_web.search"],
      dependsOn: [],
      why: "The plan must rest on market evidence.",
      evidence: [],
      fallbackFor: null,
    },
    {
      key: "plan",
      role: "DOCUMENTS",
      goal: "Write Maji Loop's 12-month growth plan from the research.",
      tools: ["documents.own.prepare"],
      dependsOn: ["research"],
      document: {
        operation: "PREPARE",
        kind: "ANALYSIS",
        scope: "OWN_COMPANY",
      },
      why: "It is what they asked for.",
      evidence: [],
      fallbackFor: null,
    },
  ],
  cannot: [],
};

const DOSSIER: ResearchDossier = {
  version: 1,
  sources: MAJI_PAGES.map((page, index) => ({
    index: index + 1,
    url: page.url,
    domain: new URL(page.url).hostname,
    title: page.title,
    publishedAt: "2024-06-01",
  })),
  facts: [
    {
      id: "F1",
      statement:
        "The Kenyan water vending market was worth KES 18 billion in 2023.",
      figure: "KES 18 billion",
      asOf: "2023",
      source: 2,
      lane: "MARKET_SIZE",
      kind: "FIGURE",
      domain: "report.example",
      title: MAJI_PAGES[1]?.title ?? null,
      url: MAJI_PAGES[1]?.url ?? "",
      publishedAt: "2024-06-01",
    },
  ],
  lanes: [
    {
      lane: "MARKET_SIZE",
      query: "kenya water kiosks market size",
      status: "OK",
      sources: 2,
    },
  ],
};

describe("the lead's plan for the Maji Loop request", () => {
  const bound = boundPlan(
    MAJI_PLAN.steps.map((step) => ({
      ...step,
      agentName: null,
      fallbackFor: undefined,
    })),
    {
      permitted: new Set(["public_web.search", "documents.own.prepare"]),
      budgetUsd: 2.4,
      executors: registeredExecutors({ research: true, documents: true }),
    },
  );

  it("is kept whole, with deep-work budgets inside the job's cap", () => {
    expect(bound.refused).toEqual([]);
    expect(bound.steps.map((step) => [step.key, step.budgetUsd])).toEqual([
      ["research", 0.6],
      ["plan", 1.2],
    ]);
    expect(bound.steps[1]?.document).toEqual({
      operation: "PREPARE",
      kind: "ANALYSIS",
      scope: "OWN_COMPANY",
    });
  });

  it("binds a NAMED_COMPANY analysis to the record code resolved, never a model's id", () => {
    const companyId = randomUUID();
    const named = boundPlan(
      [
        {
          key: "brief",
          role: "DOCUMENTS",
          agentName: null,
          goal: "Analyse Kestrel's market",
          tools: ["documents.own.prepare"],
          dependsOn: [],
          document: {
            operation: "PREPARE",
            kind: "ANALYSIS",
            scope: "NAMED_COMPANY",
          },
        },
      ],
      {
        permitted: new Set(["documents.own.prepare"]),
        budgetUsd: 2.4,
        executors: registeredExecutors({ research: false, documents: true }),
        namedCompanyId: companyId,
      },
    );
    expect(named.steps[0]?.document).toEqual({
      operation: "PREPARE",
      kind: "ANALYSIS",
      scope: "NAMED_COMPANY",
      companyId,
    });
  });
});

function world(
  options: {
    readonly outward?: boolean;
    /** What already waits for their approval (the Approval Engine's list). */
    readonly waiting?: readonly {
      summary: string;
      actionType: string;
      plan?: { outward: string[]; targets: string[] };
    }[];
  } = {},
) {
  const store = createInMemoryWorkforceStore();
  const queue = createInMemoryAgentWorkQueue();
  const documentInputs: WorkforceDocumentInput[] = [];
  const researchInputs: unknown[] = [];
  const delivered: unknown[] = [];
  const portsFor = (): WorkforcePorts => ({
    principalName: () => Promise.resolve("Amina Wanjiru"),
    mandateMatches: () => Promise.resolve([]),
    expressInterest: () => Promise.resolve({ ok: false }),
    openConversations: () => Promise.resolve([]),
    writeReply: () => Promise.resolve(null),
    send: () => Promise.resolve(false),
    freeSlots: () => Promise.resolve([]),
    book: () => Promise.resolve({ ok: false, meetingId: null }),
    notify: () => Promise.resolve(),
    research: (_owner, input) => {
      researchInputs.push(input);
      return Promise.resolve({
        status: "OK",
        query: "kenya water kiosks market size",
        sources: [],
        dossier: DOSSIER,
      });
    },
    documents: (_owner, input) => {
      documentInputs.push(input);
      return Promise.resolve({
        status: "READY",
        artifactId: "11111111-1111-4111-8111-111111111111",
        delivery: {
          title: MAJI_DRAFT_TWO.title,
          artifactType: "ANALYSIS",
          summary: MAJI_DRAFT_TWO.summary,
          topRecommendations: MAJI_DRAFT_TWO.topRecommendations,
          passed: true,
          openIssues: 0,
        },
      });
    },
  });
  const plan: JobPlanResultV8 = options.outward
    ? {
        ...MAJI_PLAN,
        steps: [
          ...MAJI_PLAN.steps,
          {
            key: "send",
            role: "CONVERSATION",
            goal: "Send the plan to my co-founder",
            tools: ["list_messages", "chat.message.send"],
            dependsOn: ["plan"],
            why: "They asked to share it.",
            evidence: [],
            fallbackFor: null,
          },
        ],
      }
    : MAJI_PLAN;
  const jobsFor = () =>
    createWorkforceJobs({
      store,
      models: {
        plan: () => Promise.resolve(plan),
        readReply: () => Promise.resolve(null),
      },
      review: createOutwardReview({
        store,
        models: {
          review: () => Promise.resolve(null),
          redraft: () => Promise.resolve(null),
        },
      }),
      ports: portsFor(),
    });
  const runner = createAgentWorkRunner({
    queue,
    store,
    actorFor: () => Promise.resolve(actor),
    jobsFor,
    deliver: (_owner, row) => {
      delivered.push(deliveredDocument(row));
      return Promise.resolve(true);
    },
    workerId: "worker-analyst",
  });
  const board = createWorkforceJobBoard({
    jobsFor,
    budgetUsd: 2.5,
    ...(options.waiting === undefined
      ? {}
      : { waiting: () => Promise.resolve(options.waiting ?? []) }),
    startOwnWork: createOwnWorkStarter({
      jobsFor,
      queue: () => queue,
    }),
  });
  return {
    board,
    queue,
    runner,
    store,
    documentInputs,
    researchInputs,
    delivered,
  };
}

describe("own-account deep work starts with no approval card", () => {
  it("starts at once, runs research then the analysis, and delivers the document", async () => {
    const { board, runner, documentInputs, researchInputs, delivered } =
      world();
    const runId = randomUUID();
    const prepared = await board.port.prepare(actor, runId, MAJI_LOOP_REQUEST);
    expect(prepared.status).toBe("STARTED");
    if (prepared.status !== "STARTED") return;
    expect(prepared.firstRead).toContain("first view");
    // No card: the proposer has nothing to file for this run.
    expect(await board.proposer.propose({ runId, actor } as never)).toBeNull();
    // Asking again in the same run never files a second job.
    expect(
      (await board.port.prepare(actor, runId, MAJI_LOOP_REQUEST)).status,
    ).toBe("STARTED");

    await runner.pass();
    expect(researchInputs).toHaveLength(1);
    expect(researchInputs[0]).toMatchObject({ budgetUsd: 0.6 });
    expect(documentInputs).toHaveLength(1);
    expect(documentInputs[0]?.research).toEqual([DOSSIER]);
    expect(documentInputs[0]?.personRequest).toBe(MAJI_LOOP_REQUEST);
    expect(documentInputs[0]?.principalName).toBe("Amina Wanjiru");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      artifactId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("is never held by an unrelated card waiting for approval (live 2026-10-24)", async () => {
    // The waiting card's own plan: research and a brief (no outward
    // action), as live; and one that sends messages.
    const savanna = {
      summary: "Prepare for the first call with Savanna Seed Partners",
      actionType: "q.workforce.job.start",
      plan: { outward: [], targets: [] },
    };
    const sending = {
      summary: "Reply to everyone who wrote",
      actionType: "q.workforce.job.start",
      plan: { outward: ["chat.message.send"], targets: [] },
    };
    const own = world({ waiting: [savanna] });
    const started = await own.board.port.prepare(
      actor,
      randomUUID(),
      "Write me a short 12-month growth plan for my company",
    );
    expect(started.status).toBe("STARTED");

    // A plan that would itself be a card is held only by the same work:
    // not by the unrelated research card, but by one sending messages too.
    const unrelated = world({ outward: true, waiting: [savanna] });
    expect(
      (
        await unrelated.board.port.prepare(
          actor,
          randomUUID(),
          "Write me a short 12-month growth plan for my company",
        )
      ).status,
    ).toBe("PREPARED");
    const same = world({ outward: true, waiting: [savanna, sending] });
    const held = await same.board.port.prepare(
      actor,
      randomUUID(),
      "Write me a short 12-month growth plan for my company",
    );
    expect(held).toMatchObject({
      status: "ALREADY_WAITING",
      about: "SAME_KIND",
      waiting: ["Reply to everyone who wrote"],
    });
  });

  it("keeps the card for work that reaches anyone else", async () => {
    const { board } = world({ outward: true });
    const runId = randomUUID();
    const prepared = await board.port.prepare(actor, runId, MAJI_LOOP_REQUEST);
    expect(prepared.status).toBe("PREPARED");
    const proposal = await board.proposer.propose({ runId, actor } as never);
    expect(proposal).not.toBeNull();
    expect(JSON.stringify(proposal)).not.toContain("Q's team");
  });

  it("classifies by tool, never by words", () => {
    const base = {
      ownerUserId: actor.userId,
      goal: "x",
      summary: "x",
      budgetUsd: "2.5",
      cannot: [],
    };
    const step = (tools: string[]) => ({
      key: "a",
      role: "RESEARCH" as const,
      agentName: "Research",
      goal: "x",
      tools,
      dependsOn: [],
      budgetUsd: "0.6",
      spawned: false,
    });
    expect(
      isOwnAccountWork({
        ...base,
        steps: [step(["public_web.search"])],
        permitted: ["public_web.search"],
      }),
    ).toBe(true);
    expect(
      isOwnAccountWork({
        ...base,
        steps: [step(["relationship.interest.express"])],
        permitted: ["relationship.interest.express"],
      }),
    ).toBe(false);
    expect(
      isOwnAccountWork({
        ...base,
        steps: [step(["diligence.questions.prepare"])],
        permitted: ["diligence.questions.prepare"],
      }),
    ).toBe(false);
  });

  it("says it is under way and gives Q's first read, as one Q", () => {
    const line = teamJobLine({
      status: "STARTED",
      plan: {
        summary: MAJI_PLAN.summary,
        steps: [],
        needsYou: [],
        cannot: [],
      },
      firstRead: MAJI_PLAN.firstRead,
    });
    expect(line).toMatch(/^On it\. Starting now: research Kenya's water/u);
    expect(line).toContain("ready in a few minutes");
    expect(line).toContain(
      `My first read, before the research is in: ${MAJI_PLAN.firstRead ?? ""}`,
    );
    expect(line).not.toMatch(/team|agent|specialist/iu);
  });
});

function topicalProvider(): PublicWebResearchProvider {
  return {
    code: "brave",
    search: (request) => {
      const words = request.query.toLowerCase().split(/\s+/u);
      return Promise.resolve({
        hits: MAJI_PAGES.filter((page) =>
          page.topic.some((topic) => words.includes(topic)),
        ).map((page) => ({
          url: page.url,
          title: page.title,
          snippet: page.text.slice(0, 100),
          publishedAt: "2024-06-01",
          relevance: 0.8,
        })),
        latencyMs: 1,
      });
    },
    extract: (request) =>
      Promise.resolve({
        pages: request.urls.flatMap((url) => {
          const page = MAJI_PAGES.find((one) => one.url === url);
          return page === undefined
            ? []
            : [{ url, title: page.title, text: page.text }];
        }),
        failedUrls: [],
        latencyMs: 1,
      }),
  };
}

describe("deep research for the Maji Loop request", () => {
  it("plans focused questions from the request alone, runs a follow-up round on what pages named, and admits only figures pages carry", async () => {
    const searched: string[] = [];
    const provider = topicalProvider();
    const service = createPublicWebResearchService({
      provider: {
        ...provider,
        search: (request, context) => {
          searched.push(request.query);
          return provider.search(request, context);
        },
      },
    });
    const planInputs: unknown[] = [];
    const factInputs: { lane: string; pages: string }[] = [];
    const models: Pick<WorkforceModels, "planResearch" | "researchFacts"> = {
      planResearch: (_who, _trace, input) => {
        planInputs.push(input);
        return Promise.resolve({
          costUsd: 0.01,
          output: {
            questions: [
              {
                lane: "MARKET_SIZE",
                query: "Kenya water kiosks market size growth",
                alsoQuery: null,
                recent: false,
              },
              {
                lane: "DEMAND",
                query: "Kenya households water access statistics",
                alsoQuery: null,
                recent: false,
              },
              {
                lane: "COMPETITORS",
                query: "Kenya water kiosks competitors",
                alsoQuery: null,
                recent: false,
              },
              {
                lane: "ALTERNATIVES",
                query: "Kenya water access alternatives",
                alsoQuery: null,
                recent: false,
              },
              {
                lane: "REGULATION",
                query: "Kenya water kiosks regulation licensing",
                alsoQuery: null,
                recent: true,
              },
              {
                lane: "UNIT_ECONOMICS",
                query: "water kiosks Kenya price per litre",
                alsoQuery: null,
                recent: false,
              },
            ],
          },
        });
      },
      researchFacts: (_who, _trace, input) => {
        factInputs.push({ lane: input.lane, pages: input.pages });
        const facts: ResearchFactsResult["facts"] =
          input.lane === "MARKET_SIZE"
            ? [
                {
                  statement:
                    "The Kenyan water vending market was worth KES 18 billion in 2023.",
                  figure: "KES 18 billion",
                  asOf: "2023",
                  source: 1,
                  kind: "FIGURE",
                },
                {
                  // Invented: no page says 30 billion.
                  statement: "The market will reach KES 30 billion by 2030.",
                  figure: "KES 30 billion",
                  asOf: "2030",
                  source: 1,
                  kind: "FIGURE",
                },
              ]
            : [];
        const page = /^S(\d+)/mu.exec(input.pages);
        return Promise.resolve({
          costUsd: 0.01,
          output: {
            facts: facts.map((fact) => ({
              ...fact,
              source: Number(page?.[1] ?? 1),
            })),
            followUps:
              input.lane === "COMPETITORS"
                ? [
                    {
                      lane: "ATM_OPERATORS",
                      query: "Majik Water atm pricing Nairobi",
                    },
                  ]
                : [],
          },
        });
      },
    };
    const research = workforceDeepResearch({ service, models });
    if (research === undefined) throw new Error("not composed");
    const found = await research({
      actor,
      runId: randomUUID(),
      jobId: randomUUID(),
      request: MAJI_LOOP_REQUEST,
      query: "Kenya's water kiosk market, competitors, regulation",
      budgetUsd: 0.6,
    });
    expect(found.status).toBe("OK");
    if (found.status !== "OK" || found.dossier === undefined) return;

    // Firewall: the planner saw the request and the goal, nothing private.
    expect(JSON.stringify(planInputs)).not.toContain(PRIVATE_MARKER);
    expect(planInputs[0]).toMatchObject({ request: MAJI_LOOP_REQUEST });
    // Six planned questions plus the follow-up the pages suggested.
    expect(found.dossier.lanes.map((lane) => lane.lane)).toEqual([
      "MARKET_SIZE",
      "DEMAND",
      "COMPETITORS",
      "ALTERNATIVES",
      "REGULATION",
      "UNIT_ECONOMICS",
      "ATM_OPERATORS",
    ]);
    // The follow-up named a competitor only a public page named.
    expect(searched).toContain("majik water atm pricing nairobi");
    expect(searched.every((query) => !query.includes("growth plan"))).toBe(
      true,
    );
    // Only the figure a page carries is admitted.
    expect(found.dossier.facts.map((fact) => fact.figure)).toEqual([
      "KES 18 billion",
    ]);
    expect(factInputs.length).toBeGreaterThanOrEqual(5);
  });

  it("is honest when no provider answers", async () => {
    const service = createPublicWebResearchService({
      provider: {
        code: "brave",
        search: () => Promise.reject(new Error("down")),
        extract: () => Promise.reject(new Error("down")),
      },
    });
    const research = workforceDeepResearch({
      service,
      models: {
        planResearch: () =>
          Promise.resolve({
            costUsd: null,
            output: {
              questions: [
                {
                  lane: "MARKET",
                  query: "Kenya water kiosks",
                  alsoQuery: null,
                  recent: false,
                },
              ],
            },
          }),
        researchFacts: vi.fn(),
      },
    });
    const found = await research?.({
      actor,
      runId: randomUUID(),
      request: MAJI_LOOP_REQUEST,
      query: "the market",
    });
    expect(found?.status).toBe("UNAVAILABLE");
  });
});

/** The analysis document port with fakes for authority and filing. */
function analysisWorld(options: {
  readonly authorised?: boolean;
  /** An earlier attempt of this step already filed its document. */
  readonly filedBefore?: { readonly gaps: readonly string[] } | undefined;
  /** The person has no company of their own (an investor). */
  readonly noCompany?: boolean | undefined;
  readonly ownContext?: string | undefined;
  readonly critiques: readonly AnalysisCritiqueResult[];
  readonly drafts: readonly AnalysisDocumentResult[];
}) {
  const filed: {
    content: QArtifactContent;
    title: string;
    subject: unknown;
  }[] = [];
  const writes: { revision: string; company: string; research: string }[] = [];
  const critiques: unknown[] = [];
  const bindings: unknown[] = [];
  const companyId = randomUUID();
  const documents = createWorkforceDocuments({
    freshActor: (who) => Promise.resolve(who),
    ownCompany: () =>
      Promise.resolve(options.noCompany === true ? null : { companyId }),
    ...(options.ownContext === undefined
      ? {}
      : { ownContext: () => Promise.resolve(options.ownContext ?? null) }),
    firewall: {
      plan: () =>
        Promise.resolve(
          options.authorised === false
            ? ({ outcome: "DENIED" } as never)
            : ({
                outcome: "AUTHORISED",
                plan: { maxSensitivity: "CONFIDENTIAL" },
              } as never),
        ),
    },
    investigate: () =>
      Promise.resolve({
        companyId,
        companyName: "Maji Loop",
        canonicalDescription:
          "Maji Loop runs solar-powered water kiosks in Nairobi.",
        blocked: null,
        findings: [
          {
            statement: `Maji Loop runs 14 kiosks in Nairobi (${PRIVATE_MARKER}).`,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
        ],
      } as never),
    artifacts: {
      findWorkforceDocument: (input: { workforce: unknown }) => {
        bindings.push(input.workforce);
        return Promise.resolve(
          options.filedBefore === undefined
            ? null
            : ({
                artifactId: "33333333-3333-4333-8333-333333333333",
                status: "READY",
                currentVersion: 1,
              } as never),
        );
      },
      requestDocument: vi.fn(),
    },
    preparation: {
      port: {
        currentVersion: () =>
          Promise.resolve({
            title: MAJI_DRAFT_TWO.title,
            summary: MAJI_DRAFT_TWO.summary,
            content: { sections: [], gaps: options.filedBefore?.gaps ?? [] },
          }),
        prepare: (input: {
          content: { title: string; content: QArtifactContent };
          subject?: unknown;
          workforce?: unknown;
        }) => {
          bindings.push(input.workforce);
          filed.push({
            content: input.content.content,
            title: input.content.title,
            subject: input.subject,
          });
          return Promise.resolve({
            artifactId: "22222222-2222-4222-8222-222222222222",
          });
        },
      },
    } as never,
    analyst: {
      writeAnalysis: (_who, _trace, input) => {
        writes.push({
          revision: input.revision,
          company: input.company,
          research: input.research,
        });
        const draft = options.drafts[writes.length - 1];
        return Promise.resolve(
          draft === undefined ? null : { output: draft, costUsd: 0.2 },
        );
      },
      critiqueAnalysis: (_who, _trace, input) => {
        critiques.push(input);
        const verdict = options.critiques[critiques.length - 1];
        return Promise.resolve(
          verdict === undefined ? null : { output: verdict, costUsd: 0.03 },
        );
      },
    },
    now: () => Date.parse("2026-10-23T18:00:00.000Z"),
  });
  const input = {
    actor,
    canContinue: () => Promise.resolve(true),
    request: {
      operation: "PREPARE" as const,
      kind: "ANALYSIS" as const,
      scope: "OWN_COMPANY" as const,
    },
    goal: "Write Maji Loop's 12-month growth plan from the research.",
    personRequest: MAJI_LOOP_REQUEST,
    principalName: "Amina Wanjiru",
    research: [DOSSIER],
    qRunId: randomUUID(),
    jobId: randomUUID(),
    stepKey: "plan",
    runId: randomUUID(),
    organisationId: actor.organisationId ?? "",
    budgetUsd: 1.2,
  };
  return { documents, input, filed, writes, critiques, companyId, bindings };
}

const FAILING: AnalysisCritiqueResult = {
  passes: false,
  score: 41,
  issues: [
    {
      kind: "MISSING_SECTION",
      section: "Recommendations",
      problem: "No sequencing by quarter, no owners and no metrics.",
      fix: "Number the recommendations with a quarter, an owner role and a metric each.",
    },
    {
      kind: "CONTRADICTION",
      section: "Market",
      problem:
        "Says everything about Maji Loop's numbers is unknown though the record states 14 kiosks.",
      fix: "Use the record's figure, labelled self-reported.",
    },
  ],
  strengths: [],
};
const PASSING: AnalysisCritiqueResult = {
  passes: true,
  score: 86,
  issues: [],
  strengths: ["Sizing states its assumptions."],
};

describe("the analysis is critiqued and really revised", () => {
  it("fixes what the critique and code found, files the revision, and the filed version passes", async () => {
    const world = analysisWorld({
      drafts: [MAJI_DRAFT_ONE, MAJI_DRAFT_TWO],
      critiques: [FAILING, PASSING],
    });
    const result = await world.documents(world.input);
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;

    // Two drafts; the second was written FROM the first's findings.
    expect(world.writes).toHaveLength(2);
    expect(world.writes[0]?.revision).toBe("");
    expect(world.writes[1]?.revision).toContain("MISSING_SECTION");
    expect(world.writes[1]?.revision).toContain("figure");
    expect(world.writes[1]?.revision).toContain(MAJI_DRAFT_ONE.summary);

    // Code's own check caught the unlabelled figures in draft one, and
    // finds none in the revision.
    expect(
      basisProblems(MAJI_DRAFT_ONE, new Set([1, 2, 3, 4])).length,
    ).toBeGreaterThan(0);
    expect(basisProblems(MAJI_DRAFT_TWO, new Set([1, 2, 3, 4]))).toEqual([]);

    // What was filed is the revision, not the criticised draft.
    const [filed] = world.filed;
    expect(filed?.title).toBe(MAJI_DRAFT_TWO.title);
    const headings = filed?.content.sections.map((section) => section.heading);
    expect(headings).toContain("Recommendations and sequencing");
    expect(headings).not.toContain("Market");
    // Sources: written by code, only those cited, numbered as cited.
    const sources = filed?.content.sections.find(
      (section) => section.heading === "Sources",
    );
    expect(sources?.body).toContain("[S2] Water kiosks in Kenya");
    expect(sources?.body).toContain("Capital Q has not verified it");
    // Sourced figures carry their truth axes as findings.
    const market = filed?.content.sections.find(
      (section) => section.heading === "Market and sizing",
    );
    expect(market?.findings[0]).toMatchObject({
      truthClass: "UNKNOWN",
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
    expect(filed?.content.gaps).toEqual(MAJI_DRAFT_TWO.gaps);

    expect(result.delivery).toMatchObject({
      passed: true,
      openIssues: 0,
      topRecommendations: MAJI_DRAFT_TWO.topRecommendations,
    });
    // The founder's own record reaches the founder's own document only.
    expect(world.writes[0]?.company).toContain("USER_CLAIM, SELF_REPORTED");
    expect(world.writes[0]?.research).toContain("F1 [S2]");
    expect(filed?.subject).toEqual({
      kind: "COMPANY",
      companyId: world.companyId,
    });

    if (process.env["CQ_WRITE_ANALYST_SAMPLE"] === "1" && filed !== undefined) {
      const path = join(
        import.meta.dirname,
        "../../../docs/ai-handoff/evidence/q-analyst/maji-loop-sample.md",
      );
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        [
          `# ${filed.title}`,
          "",
          "_Synthetic test fixture (apps/q-api/test/workforce-analyst.test.ts): fake research pages and fake analyst drafts; no live provider or model call. Shows the filed shape after critique → revise._",
          "",
          ...filed.content.sections.flatMap((section) => [
            `## ${section.heading}`,
            "",
            section.body,
            ...(section.findings.length === 0
              ? []
              : [
                  "",
                  ...section.findings.map(
                    (finding) =>
                      `> Finding (${finding.truthClass}, ${finding.evidenceStatus}): ${finding.statement}`,
                  ),
                ]),
            "",
          ]),
          "## Not known",
          "",
          ...filed.content.gaps.map((gap) => `- ${gap}`),
          "",
          "## What Q says in the conversation when it lands",
          "",
          deliveryText({
            artifactId: "22222222-2222-4222-8222-222222222222",
            delivery: {
              title: filed.title,
              artifactType: "ANALYSIS",
              summary: MAJI_DRAFT_TWO.summary,
              topRecommendations: MAJI_DRAFT_TWO.topRecommendations,
              passed: true,
              openIssues: 0,
            },
          }),
          "",
        ].join("\n"),
      );
    }
  });

  it("never calls a draft no reviewer could read 'passed', and names open points in the document", async () => {
    const world = analysisWorld({
      drafts: [MAJI_DRAFT_ONE, MAJI_DRAFT_ONE, MAJI_DRAFT_ONE],
      critiques: [FAILING, FAILING, FAILING],
    });
    const result = await world.documents(world.input);
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(world.writes).toHaveLength(3);
    expect(result.delivery?.passed).toBe(false);
    expect(result.delivery?.openIssues).toBeGreaterThan(0);
    expect(
      world.filed[0]?.content.gaps.some((gap) =>
        gap.startsWith("Reviewer's open point"),
      ),
    ).toBe(true);
  });

  it("files once per (job, step): a retry after a crash finds the filed document and writes nothing", async () => {
    const world = analysisWorld({
      drafts: [MAJI_DRAFT_TWO],
      critiques: [PASSING],
      filedBefore: { gaps: ["Reviewer's open point (Market): x"] },
    });
    const result = await world.documents(world.input);
    expect(result).toMatchObject({
      status: "READY",
      artifactId: "33333333-3333-4333-8333-333333333333",
      delivery: { passed: false, openIssues: 1 },
    });
    expect(world.writes).toHaveLength(0);
    expect(world.filed).toHaveLength(0);
    expect(world.bindings[0]).toMatchObject({
      jobId: world.input.jobId,
      stepKey: "plan",
    });
  });

  it("files under the (job, step) binding the lookup used", async () => {
    const world = analysisWorld({
      drafts: [MAJI_DRAFT_TWO],
      critiques: [PASSING],
    });
    await world.documents(world.input);
    expect(world.bindings).toHaveLength(2);
    expect(world.bindings[1]).toEqual(world.bindings[0]);
  });

  it("files nothing when the firewall does not authorise the person", async () => {
    const world = analysisWorld({
      authorised: false,
      drafts: [MAJI_DRAFT_TWO],
      critiques: [PASSING],
    });
    const result = await world.documents(world.input);
    expect(result.status).toBe("UNAVAILABLE");
    expect(world.writes).toHaveLength(0);
    expect(world.filed).toHaveLength(0);
  });
});

describe("delivery to the conversation", () => {
  it("reads the document from the job's results and says 4-6 lines", () => {
    const document = deliveredDocument({
      results: {
        research: { status: "DONE", outputs: { dossier: DOSSIER } },
        plan: {
          status: "DONE",
          outputs: {
            artifactId: "22222222-2222-4222-8222-222222222222",
            delivery: {
              title: MAJI_DRAFT_TWO.title,
              artifactType: "ANALYSIS",
              summary: MAJI_DRAFT_TWO.summary,
              topRecommendations: MAJI_DRAFT_TWO.topRecommendations,
              passed: true,
              openIssues: 0,
            },
          },
        },
      },
    });
    expect(document).not.toBeNull();
    if (document === null) return;
    const text = deliveryText(document);
    expect(
      text.split("\n").filter((line) => line.trim().length > 0).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      text.split("\n").filter((line) => line.trim().length > 0).length,
    ).toBeLessThanOrEqual(6);
    expect(text).toMatch(/^Your Maji Loop: 12-month growth plan is ready\./u);
    expect(text).toContain("1. Instrument every kiosk");
  });
});

describe("QO-07: an investor's plan is written for them", () => {
  it("reads their organisation, mandates and pipeline as them, and says unknown when a read fails", async () => {
    const reads: string[] = [];
    const read = createOwnContextReader({
      ownInvestorOrganisation: () => Promise.resolve(randomUUID()),
      records: {
        read: (_actor, query) => {
          reads.push(query.record);
          return query.record === "INVESTOR_MANDATES"
            ? Promise.reject(new Error("down"))
            : Promise.resolve({ name: "Zino Aviation Ventures" });
        },
      },
      relationships: () =>
        Promise.resolve({
          side: "INVESTOR",
          items: [
            {
              counterpart: { kind: "COMPANY", name: "Maji Loop" },
              state: "IN_DILIGENCE",
              stateSince: "2026-10-01T00:00:00.000Z",
              nextStep: "SCHEDULE_MEETING",
            },
          ],
        } as never),
    });
    const text = await read(actor);
    expect(reads.sort()).toEqual([
      "INVESTOR_MANDATES",
      "INVESTOR_ORGANISATION",
    ]);
    expect(text).toContain("Zino Aviation Ventures");
    expect(text).toContain(
      "Their mandates: none on record or not readable (unknown).",
    );
    expect(text).toContain(
      "- Maji Loop (COMPANY): IN_DILIGENCE since 2026-10-01",
    );
  });

  it("an investor's 'own' plan has no company: it is written from their context, never refused", async () => {
    const world = analysisWorld({
      drafts: [MAJI_DRAFT_TWO],
      critiques: [PASSING],
      noCompany: true,
      ownContext:
        "Their pipeline (companies they are talking to):\n- Maji Loop (COMPANY): IN_DILIGENCE since 2026-10-01",
    });
    const result = await world.documents(world.input);
    expect(result.status).toBe("READY");
    expect(world.writes[0]?.company).toContain(
      "WHO THIS IS FOR (Amina Wanjiru)",
    );
    expect(world.writes[0]?.company).toContain(
      "- Maji Loop (COMPANY): IN_DILIGENCE",
    );
    expect(world.filed[0]?.subject).toBeUndefined();
  });
});

describe("same work, by structure (2026-10-24)", () => {
  it("compares outward actions and records, never words", () => {
    const companyId = randomUUID();
    const shape = planShape(
      {
        permitted: ["public_web.search", "chat.message.send"],
        steps: [
          {
            key: "brief",
            role: "DOCUMENTS",
            agentName: "Documents",
            goal: "x",
            tools: ["documents.own.prepare"],
            dependsOn: [],
            budgetUsd: "1.2",
            spawned: false,
            document: {
              operation: "PREPARE",
              kind: "ANALYSIS",
              scope: "NAMED_COMPANY",
              companyId,
            },
          },
        ],
      },
      [],
    );
    expect(shape).toEqual({
      outward: ["chat.message.send"],
      targets: [`company:${companyId}`],
    });
    expect(
      sameWork(shape, { outward: ["chat.message.send"], targets: [] }),
    ).toBe(false);
    expect(
      sameWork(shape, {
        outward: ["chat.message.send"],
        targets: [`company:${companyId}`],
      }),
    ).toBe(true);
    // Own work takes no outward action: never the same work as anything.
    expect(
      sameWork({ outward: [], targets: [] }, { outward: [], targets: [] }),
    ).toBe(false);
  });
});

describe("waiting cards' own plans (waiting-plans.ts)", () => {
  const payload = (ownerUserId: string) => ({
    ownerUserId,
    goal: "Reply to everyone who wrote",
    summary: "Reply to everyone who wrote",
    steps: [
      {
        key: "reply",
        role: "CONVERSATION",
        agentName: "Conversation",
        goal: "Reply",
        tools: ["list_messages", "chat.message.send"],
        dependsOn: [],
        budgetUsd: "0.1",
        spawned: false,
      },
    ],
    permitted: ["list_messages", "chat.message.send"],
    budgetUsd: "2.5",
    cannot: [],
  });

  it("reads only the approver's own job cards, as shapes, never the payload", async () => {
    const mine = randomUUID();
    const notMine = randomUUID();
    const queries: unknown[][] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(values);
      return Promise.resolve([
        { approval_id: mine, payload: payload(actor.userId) },
        { approval_id: notMine, payload: payload(randomUUID()) },
      ]);
    }) as never;
    const items = await withWaitingPlans(sql, actor, [
      { approvalId: mine, summary: "a", actionType: "q.workforce.job.start" },
      {
        approvalId: notMine,
        summary: "b",
        actionType: "q.workforce.job.start",
      },
      { approvalId: randomUUID(), summary: "c", actionType: "message.send" },
    ]);
    expect(items[0]?.plan).toEqual({
      outward: ["chat.message.send"],
      targets: [],
    });
    expect(items[1]?.plan).toBeUndefined();
    expect(items[2]?.plan).toBeUndefined();
    expect(JSON.stringify(items)).not.toContain("Reply to everyone");
    // Scoped to the approver in the query itself.
    expect(queries[0]).toEqual(
      expect.arrayContaining([actor.tenantId, actor.userId]),
    );
  });
});
