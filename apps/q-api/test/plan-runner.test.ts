import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import { PLAN_F03_ASK } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import {
  deliveredPlan,
  failedPlanAnswer,
} from "../src/composition/workforce/delivery.js";
import { createWorkforceJobs } from "../src/composition/workforce/jobs.js";
import { expectedOf } from "../src/composition/workforce/progress.js";
import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";
import {
  createPlans,
  executePayloadOf,
  type PlanCardAsk,
} from "../src/composition/workforce/plans.js";
import {
  COMPANY,
  FOUNDER_DOSSIER,
  FOUNDER_PLAN,
  RUN,
  TENANT,
  contextOf,
  fakeAssembler,
  fakePlanModels,
  founder,
  memoryPlanStore,
  review,
} from "./plan-fixtures.js";

/**
 * S4 + S5 end to end, in memory: a turn's plan ask starts a plan job on the
 * durable queue (the reply carries its card at once), the runner runs it
 * as the person, the plan card is delivered in the conversation, and the
 * card's three affordances: Execute is ONE approval bound to the exact
 * version (a changed plan needs it again), Put on my board files their
 * steps with reminders, Change it files their words and starts the next
 * version.
 */

/** The few reads plans.ts makes itself, answered by the shape of the query. */
function fakeSql(input: { readonly conversationId?: string } = {}) {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("from core.companies")) {
      return Promise.resolve([{ side: "FOUNDER", id: COMPANY }]);
    }
    if (text.includes("select trace from q_runtime.agent_work_queue")) {
      return Promise.resolve([
        {
          trace: {
            runId: RUN,
            conversationId:
              input.conversationId ?? "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
          },
        },
      ]);
    }
    return Promise.resolve([]);
  }) as unknown as DatabaseExecutor;
  return { sql, queries };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function world(
  options: {
    readonly reviews?: ReturnType<typeof review>[];
    readonly writes?: Parameters<typeof fakePlanModels>[0]["writes"];
    /** The board refuses every add (as Postgres did, live 2026-10-29). */
    readonly boardDown?: boolean;
  } = {},
) {
  const options_ = options;
  const queue = createInMemoryAgentWorkQueue();
  const workforce = createInMemoryWorkforceStore();
  const plansStore = memoryPlanStore();
  const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
  const { models, calls } = fakePlanModels({
    writes: options.writes ?? [FOUNDER_PLAN],
    reviews: options.reviews ?? [review(0)],
  });
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
      },
    });
  const cards: Parameters<PlanCardAsk>[1][] = [];
  const board: { title: string; dueOn?: string; key: string }[] = [];
  const reminders: { title: string; key: string }[] = [];
  const own: string[] = [];
  const { sql } = fakeSql();
  const plans = createPlans({
    sql,
    store: plansStore.store,
    jobsFor,
    queue: () => queue,
    planJob: {
      assembler,
      toolContext: (actor: ActorContext) => Promise.resolve(contextOf(actor)),
      models,
      now: () => new Date("2026-10-28T10:00:00.000Z"),
    },
    board: {
      add: (_actor, request, options) => {
        // As workspace.board_items does: the key is a uuid column, and a
        // key that is not one fails the insert (live 2026-10-29).
        if (options.idempotencyKey.match(UUID) === null) {
          return Promise.reject(
            new Error('invalid input syntax for type uuid: "plan:…"'),
          );
        }
        if (options_.boardDown === true) {
          return Promise.reject(new Error("connection reset"));
        }
        const existing = board.find(
          (one) => one.key === options.idempotencyKey,
        );
        if (existing === undefined) {
          board.push({
            title: request.title,
            ...(request.dueOn === undefined ? {} : { dueOn: request.dueOn }),
            key: options.idempotencyKey,
          });
        }
        return Promise.resolve({
          outcome: "OK",
          replayed: existing !== undefined,
          value: {
            id: `0000000${String(board.length)}-0000-4000-8000-000000000000`,
          },
        } as never);
      },
    },
    reminder: (input) => {
      if (!reminders.some((one) => one.key === input.idempotencyKey)) {
        reminders.push({ title: input.title, key: input.idempotencyKey });
      }
      return Promise.resolve("rem_1");
    },
    ask: (_actor, card) => {
      cards.push(card);
      return Promise.resolve({
        qActionId: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a",
      });
    },
  });
  const delivered: unknown[] = [];
  const runner = createAgentWorkRunner({
    queue,
    store: workforce,
    actorFor: (who) =>
      Promise.resolve(who.userId === founder.userId ? founder : null),
    jobsFor,
    plans: (input) => plans.run(input),
    deliver: (_owner, row) => {
      delivered.push(row);
      return Promise.resolve(true);
    },
    workerId: "worker-1",
  });
  return {
    queue,
    plans,
    plansStore,
    runner,
    delivered,
    calls,
    cards,
    board,
    reminders,
    own,
  };
}

const owner = { tenantId: TENANT, userId: founder.userId };
const ASK = "how do I improve my chances of getting investment";

async function offered(w: ReturnType<typeof world>) {
  const started = await w.plans.start(founder, RUN, {
    ask: ASK,
    planAsk: {
      kind: "IMPROVE",
      research: "NONE",
      side: "FOUNDER",
      subject: "OWN",
      deliverable: "PLAN",
    },
  });
  expect(started.status).toBe("STARTED");
  if (started.status !== "STARTED") throw new Error("not started");
  await w.runner.pass();
  const row = w.delivered.at(-1) as Parameters<typeof deliveredPlan>[0];
  const plan = deliveredPlan(row);
  if (plan === null || !("plan" in plan)) throw new Error("no plan delivered");
  return { jobId: started.jobId, block: plan.plan.block, line: plan.plan.line };
}

describe("S4: a plan ask starts a durable plan job and its card lands in the thread", () => {
  it("files the job as the person's own company, runs it on the queue, delivers the PLAN card", async () => {
    const w = world();
    const { jobId, block, line } = await offered(w);
    const [row] = await w.queue.forOwner(owner, [jobId]);
    expect(row?.state).toBe("COMPLETED");
    // The job's own kind and usual length, from code: "usually 1-2 minutes".
    expect(expectedOf(row)).toEqual({
      kind: "PLAN",
      minMinutes: 1,
      maxMinutes: 2,
    });
    expect((row?.plan as { subject: unknown }).subject).toEqual({
      side: "FOUNDER",
      companyId: COMPANY,
    });
    expect(block.kind).toBe("PLAN");
    expect(block.version).toBe(1);
    expect(block.affordances).toEqual(["EXECUTE", "PUT_ON_BOARD", "CHANGE"]);
    expect(line).toContain("Your plan is ready");
    // A second pass delivers nothing new and plans nothing again.
    await w.runner.pass();
    expect(w.calls.filter((call) => call.task === "WRITE")).toHaveLength(1);
  });

  it("the F03 ask starts too: never 'nothing has started'", async () => {
    const w = world();
    const started = await w.plans.start(founder, RUN, {
      ask: PLAN_F03_ASK,
      planAsk: {
        kind: "GOAL",
        research: "NONE",
        side: "FOUNDER",
        subject: "OWN",
        deliverable: "DOCUMENT_REVIEW",
      },
    });
    expect(started.status).toBe("STARTED");
    if (started.status !== "STARTED") return;
    expect(started.title).toMatch(
      /^Review of your documents: Review the pitch deck/u,
    );
    const [row] = await w.queue.forOwner(owner, [started.jobId]);
    expect((row?.plan as { deliverable: string }).deliverable).toBe(
      "DOCUMENT_REVIEW",
    );
  });

  it("an ask about a company they name stays with the team job that writes documents", async () => {
    const w = world();
    const started = await w.plans.start(founder, RUN, {
      ask: "plan my diligence on Ledgerfold",
      planAsk: {
        kind: "GOAL",
        research: "NONE",
        side: "INVESTOR",
        subject: "NAMED",
        deliverable: "PLAN",
      },
    });
    expect(started.status).toBe("NOT_OWN");
  });
});

describe("S5: Execute is one approval bound to the exact version", () => {
  it("prepares one card whose payload is the version, its body hash and its steps", async () => {
    const w = world();
    const { block } = await offered(w);
    const view = await w.plans.view(owner, block.planId);
    expect(view?.current).toBe(true);
    if (view === null) return;
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: view.bodySha256,
    });
    expect(decided.outcome).toBe("AWAITING_APPROVAL");
    expect(w.cards).toHaveLength(1);
    expect(w.cards[0]?.actionType).toBe("q.plan.execute");
    expect(w.cards[0]?.payload).toEqual(
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    );
    expect(w.cards[0]?.key).toBe(`plan-execute:${block.planId}:1`);
  });

  it("a card showing another body is stale: nothing is prepared", async () => {
    const w = world();
    const { block } = await offered(w);
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: "0".repeat(64),
    });
    expect(decided.outcome).toBe("STALE");
    expect(w.cards).toHaveLength(0);
  });

  it("the approved version runs: Q's steps wait for their own cards, theirs go on the board", async () => {
    const w = world();
    const { block } = await offered(w);
    const view = await w.plans.view(owner, block.planId);
    if (view === null) throw new Error("no view");
    const ran = await w.plans.execute(
      founder,
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    );
    expect(ran).toBe("EXECUTED");
    // Their two tasks and the TOGETHER step's part on the board, dated ones reminded.
    expect(w.board.map((one) => one.title)).toEqual([
      "Add a Business model slide showing revenue per clinic",
      "Upload your financial model to the data room",
      "Your part: Write to Baobab Capital with your October progress",
    ]);
    expect(w.reminders).toHaveLength(3);
    // Outward proposals wait for their own cards: nothing is sent by Execute.
    const status = (await w.plans.view(owner, block.planId))?.lines.map(
      (one) => one.text,
    );
    // No card is prepared for it yet, so it is never "ready for your
    // approval" (live 2026-10-29: said with no approval behind it).
    expect(status).toContain(
      "Q will prepare it for your approval: Reply to Kestrel Ventures with revenue per clinic, as their note asked",
    );
    expect(
      status?.some((line) => line.startsWith("Ready for your approval")),
    ).toBe(false);
    expect(status).toContain(
      "Your part: Add a Business model slide showing revenue per clinic",
    );
    expect(w.plansStore.plans.get(block.planId)?.status).toBe("EXECUTING");
    // Executing again is idempotent: no second board item or reminder.
    await w.plans.execute(
      founder,
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    );
    expect(w.board).toHaveLength(3);
    expect(w.reminders).toHaveLength(3);
  });

  it("a changed plan needs the approval again: the old approval no longer runs", async () => {
    const w = world();
    const { block } = await offered(w);
    const before = await w.plans.view(owner, block.planId);
    if (before === null) throw new Error("no view");
    const approvedOld = executePayloadOf(
      founder.userId,
      before.plan,
      before.bodySha256,
    );
    // "Change it": their words become a DIRECTION and the next version.
    const changing = await w.plans.decide(founder, block.planId, {
      affordance: "CHANGE",
      version: 1,
      note: "Leave Baobab out; focus on Kestrel first.",
    });
    expect(changing.outcome).toBe("CHANGING");
    const direction = w.plansStore.thread.find(
      (one) => one.kind === "DIRECTION",
    );
    expect(direction?.author).toBe("PERSON");
    expect(direction?.text).toBe("Leave Baobab out; focus on Kestrel first.");
    await w.runner.pass();
    const after = await w.plans.view(owner, block.planId);
    expect(after?.headVersion).toBe(2);
    expect(after?.plan.supersedes).toBe(1);
    // The redraft read the person's direction.
    expect(
      w.calls.find((call) => call.task === "WRITE" && call.mode === "REDRAFT")
        ?.fixes,
    ).toContain(
      "The person asked for this change: Leave Baobab out; focus on Kestrel first.",
    );
    // The approval of version 1 no longer runs anything.
    expect(await w.plans.execute(founder, approvedOld)).toBe("STALE");
    expect(w.board).toHaveLength(0);
    // And a card for version 1 is refused as stale.
    const stale = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: before.bodySha256,
    });
    expect(stale.outcome).toBe("STALE");
  });

  it("Put on my board: every step of theirs as a task (dated ones reminded); Q's wait as proposals", async () => {
    const w = world();
    const { block } = await offered(w);
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "PUT_ON_BOARD",
      version: 1,
    });
    expect(decided.outcome).toBe("ON_BOARD");
    expect(decided.message).toContain("On your board: 3 tasks");
    expect(w.board.map((one) => one.dueOn)).toEqual([
      "2026-11-04",
      "2026-11-06",
      "2026-11-01",
    ]);
    expect(w.reminders).toHaveLength(3);
    expect(w.cards).toHaveLength(0);
    expect(w.plansStore.plans.get(block.planId)?.status).toBe("ON_BOARD");
    // Every board key is a UUID, stable per step and version.
    expect(w.board.every((one) => UUID.test(one.key))).toBe(true);
    // Again: nothing new, and it says so truthfully.
    const again = await w.plans.decide(founder, block.planId, {
      affordance: "PUT_ON_BOARD",
      version: 1,
    });
    expect(again.message).toContain("already on your board");
    expect(w.board).toHaveLength(3);
  });

  it("a board that refuses is said as a failure, never 'already there'", async () => {
    const w = world({ boardDown: true });
    const { block } = await offered(w);
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "PUT_ON_BOARD",
      version: 1,
    });
    expect(decided.outcome).toBe("FAILED");
    expect(decided.message).toMatch(/couldn't put your 3 steps on your board/u);
    expect(decided.message).not.toMatch(/already/u);
    expect(w.board).toHaveLength(0);
    expect(w.plansStore.plans.get(block.planId)?.status).not.toBe("ON_BOARD");
  });

  it("Execute with a board that refuses says so on the step, never 'your part'", async () => {
    const w = world({ boardDown: true });
    const { block } = await offered(w);
    const view = await w.plans.view(owner, block.planId);
    if (view === null) throw new Error("no view");
    await w.plans.execute(
      founder,
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    );
    const lines = (await w.plans.view(owner, block.planId))?.lines.map(
      (one) => one.text,
    );
    expect(lines).toContain(
      "Couldn't put it on your board yet: Add a Business model slide showing revenue per clinic",
    );
    expect(
      lines?.some((line) => line.startsWith("Your part: Add a Business")),
    ).toBe(false);
  });
});

describe("a plan that could not be written", () => {
  it("ends FAILED (never 'Two reviews · Ready · Filed') and still answers from what Q holds", async () => {
    const w = world({ writes: [null] });
    const started = await w.plans.start(founder, RUN, {
      ask: ASK,
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
    const [row] = await w.queue.forOwner(owner, [started.jobId]);
    expect(row?.state).toBe("FAILED");
    const answer = row === undefined ? null : failedPlanAnswer(row);
    expect(answer !== null && "answer" in answer).toBe(true);
    if (answer === null || !("answer" in answer)) return;
    expect(answer.answer.line).toContain("here is where things stand");
  });
});
