import { describe, expect, it } from "vitest";

import { QPlanSchema, type QPlan } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { PlanWriteResult } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import { createWorkforceJobs } from "../src/composition/workforce/jobs.js";
import { runPlanJob } from "../src/composition/workforce/plan-job.js";
import {
  groundPlan,
  planRoster,
  SPECIALIST_BASE_TOOLS,
  specialistFor,
} from "../src/composition/workforce/plan-job.js";
import { createPlanThread } from "../src/composition/workforce/plan-thread.js";
import {
  createPlans,
  executePayloadOf,
  stepJobPayload,
  type PlanCardAsk,
} from "../src/composition/workforce/plans.js";
import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";
import {
  COMPANY,
  FOUNDER_DOSSIER,
  FOUNDER_PLAN,
  JOB,
  LEAD_RUN,
  RUN,
  TENANT,
  contextOf,
  fakeAssembler,
  fakePlanModels,
  founder,
  memoryPlanStore,
  review,
  step,
} from "./plan-fixtures.js";

/**
 * Situation-first planning S6: the team thread, the person's direction,
 * conditions and dynamic specialists.
 *
 * - The person's words while work runs are filed as DIRECTION and every
 *   running step re-reads the thread before its next action.
 * - A step's `waitsFor` is re-evaluated on ANY domain event of the tenant
 *   (no per-feature watchers): what it waited on is verified from its own
 *   record, confirmed in the thread, and the dependent step fires.
 * - A specialist Q sets up for a step can never hold a tool wider than the
 *   run's context-eligible tools.
 */

const owner = { tenantId: TENANT, userId: founder.userId };

/** A plan whose last Q step needs approval and shares its fact with the person's step. */
const PLAN_WITH_WAIT: PlanWriteResult = {
  ...FOUNDER_PLAN,
  steps: [
    step({
      key: "S1",
      title: "Upload your financial model to the data room",
      why: "Readiness says the data room has no financial model.",
      cites: ["F7"],
      owner: "YOU",
      action: { kind: "TASK" },
      due: "2026-11-06",
    }),
    step({
      key: "S2",
      title: "Share the financial model with Kestrel Ventures",
      why: "Kestrel asked for unit economics; the model is what answers it.",
      cites: ["F7", "F4"],
      owner: "Q",
      action: { kind: "WORKFORCE", roles: ["CONVERSATION"] },
      due: null,
    }),
    step({
      key: "S3",
      title: "Research Kenyan healthtech rounds closed this year",
      why: "Savanna invests in Kenyan healthtech; recent rounds set the benchmark.",
      cites: ["F5"],
      owner: "Q",
      action: { kind: "WORKFORCE", roles: ["RESEARCH"] },
      due: null,
    }),
    step({
      key: "S4",
      title: "Find grant programmes for clinic networks",
      why: "Your raise is open; non-dilutive money extends it.",
      cites: ["F8"],
      owner: "Q",
      action: { kind: "WORKFORCE", roles: ["AD_HOC"] },
      due: null,
    }),
  ],
};

function world(input: {
  readonly plan: PlanWriteResult;
  readonly boardDone?: () => boolean;
  readonly eligible?: readonly string[];
}) {
  const queue = createInMemoryAgentWorkQueue();
  const workforce = createInMemoryWorkforceStore();
  const plansStore = memoryPlanStore();
  const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
  const { models } = fakePlanModels({
    writes: [input.plan],
    reviews: [review(0)],
  });
  const researched: string[] = [];
  const jobsFor = () =>
    createWorkforceJobs({
      store: workforce,
      models: {
        plan: () => Promise.resolve(null),
        readReply: () => Promise.resolve(null),
      },
      review: createOutwardReview({
        store: workforce,
        models: {
          review: () => Promise.resolve(null),
          redraft: () => Promise.resolve(null),
        },
      }),
      ports: {
        principalName: () => Promise.resolve("Ada"),
        mandateMatches: () => Promise.resolve([]),
        expressInterest: () => Promise.resolve({ ok: true }),
        openConversations: () => Promise.resolve([]),
        writeReply: () => Promise.resolve(null),
        send: () => Promise.resolve(false),
        freeSlots: () => Promise.resolve([]),
        book: () => Promise.resolve({ ok: false, meetingId: null }),
        notify: () => Promise.resolve(),
        research: (_owner, request) => {
          researched.push(request.query);
          return Promise.resolve({
            status: "UNAVAILABLE",
            message: "Public sources are resting.",
            reason: "PUBLIC_UNAVAILABLE",
          });
        },
      },
    });
  const boardIds: string[] = [];
  const invalidated: string[] = [];
  const cards: Parameters<PlanCardAsk>[1][] = [];
  // The reads plans.ts makes itself, answered by the shape of the query.
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from core.companies")) {
      return Promise.resolve([{ side: "FOUNDER", id: COMPANY }]);
    }
    if (text.includes("from workspace.board_items")) {
      const ids = values.find(Array.isArray) as string[] | undefined;
      return Promise.resolve(
        (ids ?? []).map((id) => ({
          id,
          status: input.boardDone?.() === true ? "DONE" : "TODO",
        })),
      );
    }
    return Promise.resolve([]);
  }) as unknown as DatabaseExecutor;
  const plans = createPlans({
    sql,
    store: plansStore.store,
    jobsFor,
    queue: () => queue,
    planJob: {
      assembler,
      toolContext: (actor: ActorContext) => Promise.resolve(contextOf(actor)),
      models,
      tools: {
        offer: () =>
          Promise.resolve(
            (input.eligible ?? SPECIALIST_BASE_TOOLS).map((name) => ({
              toolName: name as never,
              toolVersion: 1,
              classification: "READ_ONLY" as const,
              definition: { name, description: name, inputJsonSchema: {} },
              visibleStage: null,
            })),
          ),
      },
      now: () => new Date("2026-10-28T10:00:00.000Z"),
    },
    board: {
      add: (_actor, _request, options) => {
        const id = `0000000${String(boardIds.length + 1)}-0000-4000-8000-000000000000`;
        if (!boardIds.includes(options.idempotencyKey))
          boardIds.push(options.idempotencyKey);
        return Promise.resolve({ outcome: "OK", value: { id } } as never);
      },
    },
    reminder: () => Promise.resolve("rem_1"),
    ask: (_actor, card) => {
      cards.push(card);
      return Promise.resolve({
        qActionId: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a",
      });
    },
    actorFor: (who) =>
      Promise.resolve(who.userId === founder.userId ? founder : null),
    invalidate: (tenantId) => {
      invalidated.push(tenantId);
    },
  });
  const runner = createAgentWorkRunner({
    queue,
    store: workforce,
    actorFor: (who) =>
      Promise.resolve(who.userId === founder.userId ? founder : null),
    jobsFor,
    plans: (one) => plans.run(one),
    directions: (who, planId, since) => plans.directions(who, planId, since),
    deliver: () => Promise.resolve(true),
    workerId: "worker-1",
  });
  return {
    queue,
    plans,
    plansStore,
    runner,
    researched,
    cards,
    boardIds,
    invalidated,
  };
}

async function executed(w: ReturnType<typeof world>): Promise<QPlan> {
  const started = await w.plans.start(founder, RUN, {
    ask: "how do I improve my chances of getting investment",
    planAsk: {
      kind: "IMPROVE",
      research: "NONE",
      side: "FOUNDER",
      subject: "OWN",
      deliverable: "PLAN",
    },
  });
  if (started.status !== "STARTED") throw new Error("not started");
  await w.runner.pass();
  const planId = [...w.plansStore.plans.keys()][0] ?? "";
  const view = await w.plans.view(owner, planId);
  if (view === null) throw new Error("no plan");
  expect(
    await w.plans.execute(
      founder,
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    ),
  ).toBe("EXECUTED");
  return view.plan;
}

describe("the person's direction to running work", () => {
  it("a running step re-reads the thread before it acts: their words reach its next action", async () => {
    const w = world({ plan: PLAN_WITH_WAIT });
    const plan = await executed(w);
    // The research step was enqueued with the plan (own work, approved with it).
    const thread = createPlanThread(w.plansStore.store);
    const filed = await thread.direct(
      owner,
      { planId: plan.planId },
      "Only rounds that closed in 2026, please.",
      "turn-2",
    );
    // A repeated turn files nothing new (idempotent per turn).
    const again = await thread.direct(
      owner,
      { planId: plan.planId },
      "Only rounds that closed in 2026, please.",
      "turn-2",
    );
    expect(again?.id).toBe(filed?.id);
    expect(
      w.plansStore.thread.filter((one) => one.kind === "DIRECTION"),
    ).toHaveLength(1);
    await w.runner.pass();
    expect(w.researched.length).toBeGreaterThan(0);
    expect(w.researched[0]).toMatch(
      /^The person's direction since this work began \(their words; follow it where it applies to this step\): Only rounds that closed in 2026, please\./u,
    );
  });

  it("the plan being written reads their direction before it drafts", async () => {
    const plansStore = memoryPlanStore();
    const asks: string[] = [];
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    await createPlanThread(plansStore.store).direct(
      owner,
      { jobId: JOB },
      "Leave Baobab out.",
      "turn-1",
    );
    const outcome = await runPlanJob(
      {
        assembler,
        toolContext: (actor) => Promise.resolve(contextOf(actor)),
        models: {
          writePlan: (_who, _trace, variables) => {
            asks.push(variables.ask);
            return Promise.resolve(FOUNDER_PLAN);
          },
          reviewPlan: () => Promise.resolve(review(0)),
        },
        store: plansStore.store,
      },
      {
        actor: founder,
        owner,
        jobId: JOB,
        leadRunId: LEAD_RUN,
        runId: RUN,
        payload: {
          kind: "PLAN",
          ownerUserId: founder.userId,
          ask: "how do I improve my chances of getting investment",
          summary: "Your plan",
          subject: { side: "FOUNDER", companyId: COMPANY },
          research: "NONE",
          deliverable: "PLAN",
          mode: "NEW",
          planId: null,
          fromVersion: null,
          directionId: null,
        },
      },
    );
    expect(outcome.status).toBe("OFFERED");
    expect(asks[0]).toBe(
      "how do I improve my chances of getting investment\n\nThey added since: Leave Baobab out.",
    );
  });
});

describe("conditions, re-evaluated on any domain event of the tenant (addendum 2)", () => {
  it("their task done on the board fires the step that waited on it, confirmed in the thread", async () => {
    let done = false;
    const w = world({ plan: PLAN_WITH_WAIT, boardDone: () => done });
    const plan = await executed(w);
    // Code's rule: the Q step that needs approval waits on their step sharing its fact.
    expect(plan.steps.find((one) => one.key === "s2")?.waitsFor).toEqual([
      { kind: "STEP_DONE", stepKey: "s1" },
    ]);
    // Execute put their task on the board; the waiting step did not fire.
    expect(w.cards.filter((card) => card.key.endsWith(":s2"))).toHaveLength(0);
    // An unrelated-looking event of the tenant (say, a figure recorded):
    // nothing they waited on is done yet, so nothing moves.
    expect(await w.plans.wakeTenant(TENANT)).toBe(0);
    // They tick the task on their board; the next event of the tenant, of
    // any kind, re-evaluates the plan.
    done = true;
    const moved = await w.plans.wakeTenant(TENANT);
    expect(moved).toBe(2);
    const findings = w.plansStore.thread
      .filter((one) => one.kind === "FINDING")
      .map((one) => one.text);
    expect(findings).toEqual([
      "You marked it done on your board.",
      "What this step waited for is done, so it starts now: Share the financial model with Kestrel Ventures",
    ]);
    // The dependent step is outward: it gets its own approval card.
    expect(w.cards.filter((card) => card.key.endsWith(":s2"))).toHaveLength(1);
    expect(w.cards.find((card) => card.key.endsWith(":s2"))?.actionType).toBe(
      "q.workforce.job.start",
    );
    // Every event of the tenant drops its cached situations.
    expect(w.invalidated).toEqual([TENANT, TENANT]);
    // A replayed event writes nothing new.
    expect(await w.plans.wakeTenant(TENANT)).toBe(0);
    expect(w.cards.filter((card) => card.key.endsWith(":s2"))).toHaveLength(1);
  });
});

describe("dynamic specialists (addendum 1)", () => {
  it("a step no built-in role covers gets a named specialist, created with the plan's approval", async () => {
    const w = world({ plan: PLAN_WITH_WAIT });
    const plan = await executed(w);
    expect(plan.specialists).toEqual([
      {
        stepKey: "s4",
        name: "Find grant programmes for clinic",
        purpose: "Your raise is open; non-dilutive money extends it.",
        tools: [
          "research_public_web",
          "extract_public_web",
          "lookup_public_profile",
        ],
        examples: ["Find grant programmes for clinic networks"],
        budgetUsd: 0.2,
        maxModelCalls: 4,
      },
    ]);
    const view = await w.plans.view(owner, plan.planId);
    if (view === null) throw new Error("no view");
    const payload = executePayloadOf(
      founder.userId,
      view.plan,
      view.bodySha256,
    );
    expect(payload.specialists).toEqual([
      {
        stepKey: "s4",
        name: "Find grant programmes for clinic",
        tools: [
          "research_public_web",
          "extract_public_web",
          "lookup_public_profile",
        ],
      },
    ]);
    // Run by the same job runner, under its own name, with only public reading.
    const grant = plan.steps.find((one) => one.key === "s4");
    if (grant === undefined) throw new Error("no specialist step");
    const job = stepJobPayload(founder.userId, plan, grant);
    expect(
      job?.steps.map((one) => [
        one.role,
        one.agentName,
        one.tools,
        one.spawned,
      ]),
    ).toEqual([
      [
        "AD_HOC",
        "Find grant programmes for clinic",
        ["public_web.search"],
        true,
      ],
    ]);
  });

  it("its tools are never wider than the run's context-eligible tools", () => {
    const written = { ...PLAN_WITH_WAIT };
    const ground = (eligible: readonly string[]) =>
      groundPlan({
        written,
        dossier: FOUNDER_DOSSIER,
        roster: planRoster("FOUNDER"),
        eligibleTools: new Set(eligible),
      }).specialists;
    // Only one public tool offered here: only that one.
    expect(
      ground(["research_public_web", "propose_email", "send_email"])[0]?.tools,
    ).toEqual(["research_public_web"]);
    // A context offering none of them: no specialist at all (the step waits).
    expect(ground(["propose_email", "chat.message.send"])).toEqual([]);
    // Whatever the context offers, never a tool outside the public reading set.
    for (const eligible of [
      [
        "research_public_web",
        "extract_public_web",
        "lookup_public_profile",
        "propose_email",
      ],
      ["lookup_public_profile", "run_sql", "send_email"],
    ]) {
      for (const one of ground(eligible)) {
        for (const tool of one.tools) {
          expect(eligible).toContain(tool);
          expect(SPECIALIST_BASE_TOOLS).toContain(tool);
        }
      }
    }
    // The contract refuses a specialist on a step of the person's.
    const steps = groundPlan({
      written,
      dossier: FOUNDER_DOSSIER,
      roster: planRoster("FOUNDER"),
    }).steps;
    const yours = steps.find((one) => one.owner === "YOU");
    expect(specialistFor(yours, undefined)).toBeNull();
  });

  it("the plan contract refuses a specialist for a step that is not Q's work", () => {
    const grounded = groundPlan({
      written: PLAN_WITH_WAIT,
      dossier: FOUNDER_DOSSIER,
      roster: planRoster("FOUNDER"),
    });
    const parsed = QPlanSchema.safeParse({
      planId: "7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d",
      version: 1,
      side: "FOUNDER",
      goal: grounded.goal,
      situationSummary: grounded.situationSummary,
      situationRefs: grounded.situationRefs,
      steps: grounded.steps,
      openQuestions: [],
      review: null,
      status: "DRAFT",
      supersedes: null,
      createdAt: "2026-10-28T10:00:00.000Z",
      specialists: [{ ...grounded.specialists[0], stepKey: "s1" }],
    });
    expect(parsed.success).toBe(false);
  });
});
