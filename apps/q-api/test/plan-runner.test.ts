import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QPlanExecutePayloadSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { PLAN_F03_ASK } from "@capital-q/q-core";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  deliveredPlan,
  failedPlanAnswer,
} from "../src/composition/workforce/delivery.js";
import { createWorkforceJobs } from "../src/composition/workforce/jobs.js";
import { expectedOf } from "../src/composition/workforce/progress.js";
import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { stepRuntimes } from "../src/composition/workforce/plan-thread.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";
import type { StepRuntime } from "../src/composition/workforce/plan-thread.js";
import {
  createPlans,
  executePayloadOf,
  jobOutputLine,
  planStartedLine,
  stepRoles,
  stepDoneLine,
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
function fakeSql(
  input: {
    readonly conversationId?: string;
    /** P3: every board task the plan placed reads DONE. */
    readonly boardDone?: () => boolean;
    /** The actor's organisation is an investor's (live5). */
    readonly investor?: boolean;
  } = {},
) {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push(text);
    if (
      text.includes("from workspace.board_items") &&
      input.boardDone?.() === true
    ) {
      const ids = (values[2] ?? []) as string[];
      return Promise.resolve(ids.map((id) => ({ id, status: "DONE" })));
    }
    if (text.includes("from core.companies")) {
      return Promise.resolve([
        input.investor === true
          ? { side: "INVESTOR", id: COMPANY }
          : { side: "FOUNDER", id: COMPANY },
      ]);
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
    /**
     * Owner 2026-11-04: Execute approves its card as the person. The fake
     * engine approves the card's own stored payload and runs it once per
     * action (the execution gate's claim).
     */
    readonly approve?: boolean;
    /** The actor's organisation is an investor's (live5). */
    readonly investor?: boolean;
  } = {},
) {
  const said: { runId: string; key: string; text: string }[] = [];
  let boardDone = false;
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
  const approvals: string[] = [];
  const vias: unknown[] = [];
  const executed = new Set<string>();
  const board: { title: string; dueOn?: string; key: string }[] = [];
  const reminders: { title: string; key: string }[] = [];
  const own: string[] = [];
  const { sql } = fakeSql({
    boardDone: () => boardDone,
    investor: options.investor === true,
  });
  const plans = createPlans({
    say: (_owner, line) => {
      if (said.some((one) => one.key === line.key)) {
        return Promise.resolve(false);
      }
      said.push(line);
      return Promise.resolve(true);
    },
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
      // One card per key, as the run's idempotency key makes it.
      const seen = cards.findIndex((one) => one.key === card.key);
      if (seen === -1) cards.push(card);
      const index = seen === -1 ? cards.length - 1 : seen;
      return Promise.resolve({
        qActionId: `5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a${String(index).padStart(2, "0")}`,
      });
    },
    ...(options.approve === true
      ? {
          approve: async (
            actor: ActorContext,
            actionId: string,
            via?: {
              readonly channel: "CARD" | "TEXT" | "VOICE";
              readonly evidenceRef?: string | undefined;
            },
          ) => {
            approvals.push(actionId);
            vias.push(via ?? { channel: "CARD" });
            if (executed.has(actionId)) return "STARTED" as const;
            const index = Number(actionId.slice(-2));
            const card = cards[index];
            if (card === undefined) return "FAILED" as const;
            executed.add(actionId);
            const ran = await plans.execute(
              actor,
              QPlanExecutePayloadSchema.parse(card.payload),
            );
            return ran === "EXECUTED"
              ? ("STARTED" as const)
              : ("CHANGED" as const);
          },
        }
      : {}),
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
    approvals,
    vias,
    said,
    markBoardDone: () => {
      boardDone = true;
    },
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

  it("live 2026-10-31: a plan taken up from Q's offer is filed, queued and titled from the offered question; a reply is never the title", async () => {
    const planAsk = {
      kind: "GOAL",
      research: "NONE",
      side: null,
      subject: "OWN",
      deliverable: "PLAN",
    } as const;
    const w = world();
    // Taken up: the answer passes the offered question as the ask.
    const taken = await w.plans.start(founder, RUN, {
      ask: "What should I do today?",
      planAsk,
    });
    if (taken.status !== "STARTED") throw new Error("not started");
    expect(taken.title).toBe("Your plan: What should I do today?");
    const [row] = await w.queue.forOwner(owner, [taken.jobId]);
    expect(row?.plan).toMatchObject({
      ask: "What should I do today?",
      summary: "Your plan: What should I do today?",
    });
    // Offered but not read as taken up: both words planned, none quoted.
    const other = world();
    const standing = await other.plans.start(founder, RUN, {
      ask: "What should I do today?\nyes",
      planAsk,
      quote: null,
    });
    if (standing.status !== "STARTED") throw new Error("not started");
    expect(standing.title).toBe("Your plan");
    const [kept] = await other.queue.forOwner(owner, [standing.jobId]);
    expect(kept?.plan).toMatchObject({
      ask: "What should I do today?\nyes",
      summary: "Your plan",
    });
    // The finished plan's card and line carry the same title.
    await other.runner.pass();
    expect(JSON.stringify(other.delivered.at(-1))).not.toContain(
      "Your plan: yes",
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

  it("live5: an investor's plan for their work on a company they name is their plan", async () => {
    const w = world({ investor: true });
    const started = await w.plans.start(founder, RUN, {
      ask: "Make me a plan to check Ledgerline's unit economics this week",
      planAsk: {
        kind: "GOAL",
        research: "NONE",
        side: "INVESTOR",
        subject: "NAMED",
        deliverable: "PLAN",
      },
    });
    expect(started.status).toBe("STARTED");
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
    // Coordinator 2026-11-04: a message step is prepared by the existing
    // outward workforce card (q.workforce.job.start), approved on its own;
    // "ready" only because that card exists. A connection request has no
    // preparer: it needs the person's words, and says so.
    expect(status).toContain(
      "Ready for your approval: Reply to Kestrel Ventures with revenue per clinic, as their note asked",
    );
    expect(
      w.cards.filter((card) => card.actionType === "q.workforce.job.start")
        .length,
    ).toBeGreaterThan(0);
    expect(status).toContain(
      "Needs you: tell Q what to prepare: Request a connection with Savanna Health Fund",
    );
    expect(status?.some((line) => line.startsWith("Q will prepare"))).toBe(
      false,
    );
    expect(status).toContain(
      "Your part: Add a Business model slide showing revenue per clinic",
    );
    expect(w.plansStore.plans.get(block.planId)?.status).toBe("EXECUTING");
    // Live e11: each step reads where it stands (the thread's projection),
    // while the body hash the approval bound to stays the stored one.
    const running = await w.plans.view(owner, block.planId);
    expect(running?.bodySha256).toBe(view.bodySha256);
    const byTitle = new Map(
      (running?.plan.steps ?? []).map((step) => [step.title, step] as const),
    );
    const theirs = byTitle.get(
      "Add a Business model slide showing revenue per clinic",
    );
    expect(theirs?.status).toBe("WAITING_YOU");
    expect(theirs?.boardItemId).toMatch(UUID);
    expect(
      byTitle.get(
        "Reply to Kestrel Ventures with revenue per clinic, as their note asked",
      )?.status,
    ).toBe("PROPOSED");
    // Live e11: Execute on a running plan prepares no second approval.
    const cardsBefore = w.cards.length;
    const again = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: view.plan.version,
      bodySha256: view.bodySha256,
    });
    expect(again.outcome).toBe("EXECUTING");
    expect(w.cards).toHaveLength(cardsBefore);
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

  it("Put on my board, then Execute, starts what Execute alone starts (live 2026-10-29: nothing started)", async () => {
    const run = async (boardFirst: boolean) => {
      const w = world();
      const { block } = await offered(w);
      if (boardFirst) {
        await w.plans.decide(founder, block.planId, {
          affordance: "PUT_ON_BOARD",
          version: 1,
        });
      }
      const view = await w.plans.view(owner, block.planId);
      if (view === null) throw new Error("no view");
      expect(
        await w.plans.execute(
          founder,
          executePayloadOf(founder.userId, view.plan, view.bodySha256),
        ),
      ).toBe("EXECUTED");
      const states = [
        ...stepRuntimes(
          w.plansStore.thread.filter((one) => one.planId === block.planId),
        ).entries(),
      ]
        .map(
          ([key, one]) =>
            `${key}:${one.status}:${one.jobId === null ? "" : "job"}`,
        )
        .sort();
      return { states, board: w.board.length, cards: w.cards.length };
    };
    const alone = await run(false);
    const afterBoard = await run(true);
    expect(afterBoard.states).toEqual(alone.states);
    expect(afterBoard.board).toBe(alone.board);
    expect(afterBoard.cards).toBe(alone.cards);
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

/** The plan's execute cards (a step's own outward card is another kind). */
const executeCards = (w: ReturnType<typeof world>) =>
  w.cards.filter((card) => card.actionType === "q.plan.execute");

describe("owner 2026-11-04: Execute is the approval, once", () => {
  it("a press of Execute approves its one card and starts the plan, with no second prompt", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    const view = await w.plans.view(owner, block.planId);
    if (view === null) throw new Error("no view");
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: view.bodySha256,
    });
    expect(decided.outcome).toBe("EXECUTING");
    expect(decided.message).toMatch(/^Running it now/u);
    // One card, approved once, bound to the version the card showed.
    expect(executeCards(w)).toHaveLength(1);
    expect(executeCards(w)[0]?.payload).toEqual(
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    );
    expect(w.approvals).toEqual([decided.actionId]);
    expect(w.plansStore.plans.get(block.planId)?.status).toBe("EXECUTING");
    expect(w.board).toHaveLength(3);
    // A second press: already running; nothing prepared, approved or run.
    const again = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: view.bodySha256,
    });
    expect(again.outcome).toBe("EXECUTING");
    expect(executeCards(w)).toHaveLength(1);
    expect(w.approvals).toHaveLength(1);
    expect(w.board).toHaveLength(3);
  });

  it("a card already waiting for this version (the plan-ready offer) is the one approved", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    const offer = await w.plans.offer(founder, block.planId, 1);
    expect(offer).not.toBeNull();
    const view = await w.plans.view(owner, block.planId);
    if (view === null) throw new Error("no view");
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: view.bodySha256,
    });
    expect(decided.outcome).toBe("EXECUTING");
    expect(decided.actionId).toBe(offer?.qActionId);
    expect(executeCards(w)).toHaveLength(1);
  });

  it("a press on a card showing another body approves nothing", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: "0".repeat(64),
    });
    expect(decided.outcome).toBe("STALE");
    expect(w.cards).toHaveLength(0);
    expect(w.approvals).toHaveLength(0);
  });

  it("a changed plan needs its own approval: the old version's press approves nothing", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    const before = await w.plans.view(owner, block.planId);
    if (before === null) throw new Error("no view");
    await w.plans.decide(founder, block.planId, {
      affordance: "CHANGE",
      version: 1,
      note: "Leave Baobab out; focus on Kestrel first.",
    });
    await w.runner.pass();
    const stale = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: before.bodySha256,
    });
    expect(stale.outcome).toBe("STALE");
    expect(w.approvals).toHaveLength(0);
    // The new version is approved on its own card when pressed.
    const after = await w.plans.view(owner, block.planId);
    if (after === null) throw new Error("no view");
    const ran = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 2,
      bodySha256: after.bodySha256,
    });
    expect(ran.outcome).toBe("EXECUTING");
    expect(executeCards(w).map((card) => card.key)).toEqual([
      `plan-execute:${block.planId}:2`,
    ]);
  });

  it("without the approval port, Execute only prepares the card (as before)", async () => {
    const w = world();
    const { block } = await offered(w);
    const view = await w.plans.view(owner, block.planId);
    if (view === null) throw new Error("no view");
    const decided = await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: view.bodySha256,
    });
    expect(decided.outcome).toBe("AWAITING_APPROVAL");
    expect(w.plansStore.plans.get(block.planId)?.status).not.toBe("EXECUTING");
  });
});

describe("P3 (owner 2026-11-04): a running plan reports what really happened", () => {
  it("says what Execute started, each step that lands, and when the plan has run", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    const view = await w.plans.view(owner, block.planId);
    if (view === null) throw new Error("no view");
    await w.plans.decide(founder, block.planId, {
      affordance: "EXECUTE",
      version: 1,
      bodySha256: view.bodySha256,
    });
    const started = w.said.find((one) => one.key.endsWith(":started"));
    expect(started?.runId).toBe(RUN);
    // Counted from the thread: 3 board tasks (all dated, so reminded).
    expect(started?.text).toMatch(
      /^Your plan is running: \d+ steps\. .*On your board: 3 tasks, 3 with a reminder\./u,
    );
    // Said once: a replayed start says nothing new.
    await w.plans.execute(
      founder,
      executePayloadOf(founder.userId, view.plan, view.bodySha256),
    );
    expect(w.said.filter((one) => one.key.endsWith(":started"))).toHaveLength(
      1,
    );
    // The person marks their tasks done: each lands with the real count.
    w.markBoardDone();
    await w.plans.evaluatePlan(owner, block.planId);
    const done = w.said.filter((one) => one.key.endsWith(":done"));
    expect(done.length).toBeGreaterThan(0);
    expect(done[0]?.text).toMatch(
      /^Step \d+ done: .+\. You marked it done on your board\. \d+ of \d+ steps done\.$/u,
    );
    // Nothing is said twice for the same step.
    await w.plans.evaluatePlan(owner, block.planId);
    expect(w.said.filter((one) => one.key.endsWith(":done"))).toHaveLength(
      done.length,
    );
  });
});

describe("P3 lines are counted, never estimated", () => {
  const runtime = (over: Partial<StepRuntime>): StepRuntime => ({
    status: "TODO",
    boardItemId: null,
    jobId: null,
    reminderId: null,
    actionId: null,
    ...over,
  });
  const steps = [
    { key: "S1", title: "Draft the update" },
    { key: "S2", title: "Upload the model" },
    { key: "S3", title: "Write to Kestrel" },
  ] as const;
  it("the start line says only the parts that happened", () => {
    const line = planStartedLine(
      { steps: steps as never },
      new Map([
        ["S1", runtime({ status: "DOING", jobId: "j1" })],
        ["S2", runtime({ status: "WAITING_YOU", boardItemId: "b1" })],
        ["S3", runtime({ status: "PROPOSED" })],
      ]),
    );
    expect(line).toBe(
      "Your plan is running: 3 steps. Started now: 1 step of mine. On your board: 1 task. Needs you first: 1 step -- tell me what to prepare. I'll tell you here as each step lands.",
    );
  });

  it("a step's line names what its job filed, from the job's record", () => {
    expect(
      jobOutputLine({
        documents: {
          status: "DONE",
          summary: "Filed",
          outputs: { artifactId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b" },
        },
      }),
    ).toBe("It filed 1 document to your documents.");
    expect(jobOutputLine({})).toBeNull();
    expect(
      stepDoneLine(
        { steps: steps as never },
        {
          step: steps[0],
          verified: "Q's work on it finished.",
          output: "It filed 1 document to your documents.",
        },
        1,
      ),
    ).toBe(
      "Step 1 done: Draft the update. Q's work on it finished. It filed 1 document to your documents. 1 of 3 steps done.",
    );
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

describe("coordinator 2026-11-04: which proposal steps the workforce prepares", () => {
  it("a message, an interest or a meeting runs as outward workforce work; others need you", () => {
    const of = (tool: string) =>
      stepRoles({ action: { kind: "TOOL_PROPOSAL", tool } } as never);
    expect(of("propose_chat_message")).toEqual(["CONVERSATION"]);
    expect(of("propose_express_interest")).toEqual(["OUTREACH"]);
    expect(of("propose_meeting")).toEqual(["SCHEDULER"]);
    for (const tool of [
      "propose_email",
      "propose_reminder",
      "propose_connection_request",
      "propose_interest_answer",
      "propose_connection_request_answer",
    ]) {
      expect(of(tool)).toBeNull();
    }
    expect(stepRoles({ action: { kind: "TASK" } } as never)).toBeNull();
  });
});

describe("live 2026-11-04: a yes to Q's offer runs the offered plan (decision 55)", () => {
  it("approves the offer's waiting card on their words, once, and the plan runs", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    const offer = await w.plans.offer(founder, block.planId, 1);
    expect(offer).not.toBeNull();
    const evidenceRef = randomUUID();
    const ran = await w.plans.runOffered(founder, {
      planId: block.planId,
      version: 1,
      evidenceRef,
      channel: "TEXT",
    });
    expect(ran.status).toBe("STARTED");
    // The card the offer prepared, never a second one; their message is
    // the evidence the audit row keeps.
    expect(executeCards(w)).toHaveLength(1);
    expect(w.approvals).toEqual([offer?.qActionId]);
    expect(w.vias).toEqual([{ channel: "TEXT", evidenceRef }]);
    expect(w.plansStore.plans.get(block.planId)?.status).toBe("EXECUTING");
    // Said again: already running, nothing approved twice.
    const again = await w.plans.runOffered(founder, {
      planId: block.planId,
      version: 1,
      evidenceRef: randomUUID(),
      channel: "TEXT",
    });
    expect(again.status).toBe("RUNNING");
    expect(w.approvals).toHaveLength(1);
  });

  it("an older version, or someone else's plan, runs nothing", async () => {
    const w = world({ approve: true });
    const { block } = await offered(w);
    expect(
      (
        await w.plans.runOffered(founder, {
          planId: block.planId,
          version: 2,
          evidenceRef: randomUUID(),
          channel: "TEXT",
        })
      ).status,
    ).toBe("NONE");
    const stranger = ActorContextSchema.parse({
      ...founder,
      userId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
    });
    expect(
      (
        await w.plans.runOffered(stranger, {
          planId: block.planId,
          version: 1,
          evidenceRef: randomUUID(),
          channel: "TEXT",
        })
      ).status,
    ).toBe("NONE");
    expect(w.approvals).toEqual([]);
  });
});
