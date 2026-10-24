import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { WorkforceJobStartPayloadSchema } from "@capital-q/contracts";
import type { AnyQActionDefinition } from "@capital-q/q-actions";
import type { JobPlanResultV2, JobPlanResultV5 } from "@capital-q/q-core";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createWorkforceJobActions,
  createWorkforceJobBoard,
  needsYouFor,
  plannedFrom,
  relatedWaiting,
  waitingSameWork,
  type WaitingItem,
} from "../src/composition/workforce/job-actions.js";
import {
  createWorkforceJobs,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Founder brief J1/J4, live: Q proposes a job, the lead Q's plan is the
 * card's exact payload, and only the approved plan runs -- as the approver,
 * through their own ports, never re-planned, never wider than approved.
 * No model or provider is called: the plan and the ports are fakes.
 */

const tenantId = randomUUID();
const userId = randomUUID();
const actor = ActorContextSchema.parse({
  tenantId,
  userId,
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const stranger = ActorContextSchema.parse({
  tenantId,
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

const PLAN: JobPlanResultV2 = {
  summary: "Express interest in companies that fit your mandate.",
  steps: [
    {
      key: "watch",
      role: "DISCOVERY",
      goal: "Shortlist companies that fit",
      tools: ["search_companies"],
      dependsOn: [],
    },
    {
      key: "reach",
      role: "OUTREACH",
      goal: "Express interest in the shortlist",
      tools: ["relationship.interest.express", "email.send"],
      dependsOn: ["watch"],
    },
  ],
  cannot: [],
};

/** A plan naming a role with no executor here: never offered (D1). */
const UNRUNNABLE: JobPlanResultV2 = {
  summary: "Make a one-pager and send it.",
  steps: [
    {
      key: "deck",
      role: "DOCUMENTS",
      goal: "Make a one-pager",
      tools: ["list_my_documents"],
      dependsOn: [],
    },
  ],
  cannot: [],
};

/** A v2-shaped plan as JOB_PLAN v5 returns it: reasons, no evidence. */
function asPlanV5(plan: JobPlanResultV2): JobPlanResultV5 {
  return {
    ...plan,
    outcome: plan.summary,
    prerequisites: [],
    nextActions: [],
    steps: plan.steps.map((step) => ({
      ...step,
      why: "It moves the job towards its outcome.",
      evidence: [],
      fallbackFor: null,
    })),
  };
}

function world(
  withinLimit: boolean | (() => Promise<boolean>) = true,
  plan: JobPlanResultV2 | null | readonly JobPlanResultV2[] = PLAN,
  /** What already waits for their approval (the Approval Engine's list). */
  waiting?: readonly WaitingItem[],
) {
  const checkLimit = () =>
    typeof withinLimit === "function"
      ? withinLimit()
      : Promise.resolve(withinLimit);
  const store = createInMemoryWorkforceStore();
  const expressed: { by: string; companyId: string; key: string }[] = [];
  let plans = 0;
  const portsFor = (who: ActorContext): WorkforcePorts => ({
    principalName: () => Promise.resolve("Ada Obi"),
    mandateMatches: () =>
      Promise.resolve([{ companyId: "c-1", name: "Kestrel Heat" }]),
    expressInterest: (_owner, companyId, key) => {
      expressed.push({ by: who.userId, companyId, key });
      return Promise.resolve({ ok: true });
    },
    openConversations: () => Promise.resolve([]),
    writeReply: () => Promise.resolve(null),
    send: () => Promise.resolve(false),
    freeSlots: () => Promise.resolve([]),
    book: () => Promise.resolve({ ok: false, meetingId: null }),
    notify: () => Promise.resolve(),
  });
  const jobsFor = (who: ActorContext) =>
    createWorkforceJobs({
      store,
      models: {
        plan: () => {
          plans += 1;
          // A list: the lead's successive answers (a replan reads the next).
          const answers: readonly (JobPlanResultV2 | null)[] =
            plan === null || !("length" in plan) ? [plan] : plan;
          const one = answers[Math.min(plans, answers.length) - 1] ?? null;
          return Promise.resolve(one === null ? null : asPlanV5(one));
        },
        readReply: () => Promise.resolve(null),
      },
      review: createOutwardReview({
        store,
        models: {
          review: () => Promise.resolve(null),
          redraft: () => Promise.resolve(null),
        },
      }),
      ports: portsFor(who),
      withinLimit: checkLimit,
    });
  const board = createWorkforceJobBoard({
    jobsFor,
    withinLimit: checkLimit,
    ...(waiting === undefined
      ? {}
      : { waiting: () => Promise.resolve(waiting) }),
  });
  // Recovery D3: approval enqueues; the durable runner carries it out.
  const queue = createInMemoryAgentWorkQueue();
  const runner = createAgentWorkRunner({
    queue,
    store,
    actorFor: (owner) =>
      Promise.resolve(
        owner.userId === actor.userId
          ? actor
          : owner.userId === stranger.userId
            ? stranger
            : null,
      ),
    jobsFor,
    workerId: "worker-test",
  });
  const [definition] = createWorkforceJobActions({
    jobsFor,
    queue,
    kick: () => {
      void runner.pass();
    },
  });
  if (definition === undefined) throw new Error("no action");
  return {
    store,
    expressed,
    board,
    definition,
    plans: () => plans,
    queue,
    runner,
  };
}

async function execute(
  definition: AnyQActionDefinition,
  payload: unknown,
  approver: ActorContext,
) {
  const actionId = randomUUID();
  const report = await definition.executor.execute(
    {
      actionId,
      payload,
    } as unknown as Parameters<typeof definition.executor.execute>[0],
    {
      approver,
      correlationId: "cor_test",
      attempt: 1,
    },
  );
  return { actionId, report };
}

describe("a job the lead Q proposes (J1, J4)", () => {
  it("does not plan new work when the spending ledger is unavailable", async () => {
    const { board, plans } = world(() =>
      Promise.reject(new Error("ledger unavailable")),
    );
    expect(
      (await board.port.prepare(actor, "run-ledger-down", "Find me fits"))
        .status,
    ).toBe("FAILED");
    expect(plans()).toBe(0);
  });

  it("says planning failed on its side, not NOT_PLANNED, when the planner's model call fails", async () => {
    // Live 2026-10-12: the provider refused (credit exhausted) and Q asked
    // the person to reword a goal that was fine.
    const { board, plans } = world(true, null);
    const prepared = await board.port.prepare(
      actor,
      "run-down",
      "Find me fits",
    );
    expect(prepared.status).toBe("FAILED");
    expect(plans()).toBe(1);
  });

  it("holds already-approved queued work when spending cannot be checked", async () => {
    let unavailable = false;
    const { board, definition, store, expressed } = world(() =>
      unavailable
        ? Promise.reject(new Error("ledger unavailable"))
        : Promise.resolve(true),
    );
    await board.port.prepare(actor, "run-ledger-after", "Find me fits");
    const proposal = await board.proposer.propose({
      runId: "run-ledger-after",
      actor,
    } as unknown as Parameters<typeof board.proposer.propose>[0]);
    if (proposal === null || "refused" in proposal) throw new Error("none");
    unavailable = true;
    await execute(
      definition,
      WorkforceJobStartPayloadSchema.parse(proposal.payload),
      actor,
    );
    await vi.waitFor(() => expect(store.rows.jobs[0]?.status).toBe("HELD"));
    expect(expressed).toEqual([]);
    expect(store.rows.runs.find((run) => run.role === "LEAD")?.summary).toMatch(
      /couldn't check.*spending/i,
    );
  });

  it("plans, shows the plan in plain words, and proposes it as the card", async () => {
    const { board } = world();
    const prepared = await board.port.prepare(actor, "run-1", "Find me fits");
    expect(prepared.status).toBe("PREPARED");
    if (prepared.status !== "PREPARED") throw new Error("not prepared");
    expect(prepared.plan.steps).toEqual([
      { who: "Mandate watcher", does: "Shortlist companies that fit" },
      { who: "Outreach", does: "Express interest in the shortlist" },
    ]);
    // One plan per turn: asking again in the same run shows the same one.
    expect(
      (await board.port.prepare(actor, "run-1", "Something else")).status,
    ).toBe("ONE_PER_TURN");
    // Another person's run never proposes this card.
    expect(
      await board.proposer.propose({
        runId: "run-1",
        actor: stranger,
      } as unknown as Parameters<typeof board.proposer.propose>[0]),
    ).toBeNull();
  });

  it("runs exactly the approved plan as the approver, never re-planned", async () => {
    const { board, definition, store, expressed, plans, queue } = world();
    await board.port.prepare(actor, "run-2", "Find me fits");
    const proposal = await board.proposer.propose({
      runId: "run-2",
      actor,
    } as unknown as Parameters<typeof board.proposer.propose>[0]);
    if (proposal === null || "refused" in proposal) throw new Error("none");
    const payload = WorkforceJobStartPayloadSchema.parse(proposal.payload);
    // Outreach got only its executor's tools that the job permits.
    expect(payload.steps[1]).toMatchObject({
      role: "OUTREACH",
      spawned: false,
      tools: ["relationship.interest.express"],
    });
    expect(plans()).toBe(1);

    // Someone else cannot approve another person's job.
    expect(await definition.authorize(payload, stranger)).toMatchObject({
      outcome: "DENY",
    });

    const { actionId, report } = await execute(definition, payload, actor);
    expect(report.outcome).toBe("EXECUTED");
    await vi.waitFor(() => {
      expect(store.rows.jobs[0]?.status).toBe("DONE");
    });
    expect(store.rows.jobs[0]).toMatchObject({
      source_kind: "JOB",
      source_id: actionId,
    });
    // D3: the work row reached a terminal state, traceable to its card.
    await vi.waitFor(() => {
      expect(queue.rows[0]?.state).toBe("COMPLETED");
    });
    expect(queue.rows[0]?.trace).toMatchObject({ actionId });
    expect(plans()).toBe(1);
    expect(expressed.every((one) => one.by === userId)).toBe(true);
    expect(expressed.length).toBeGreaterThan(0);
    expect(
      store.rows.runs
        .filter((run) => run.role !== "LEAD")
        .map((r) => [r.role, r.status]),
    ).toEqual([
      ["MANDATE_WATCHER", "DONE"],
      ["OUTREACH", "DONE"],
    ]);
  });

  it("replans once when a step lacks its role's required tool, and offers only the plan that can run (production 2026-10-15)", async () => {
    // As planned live for savanna-seed: a CONVERSATION step with only
    // list_messages was approved, then held "Not allowed to do this step".
    const readOnly: JobPlanResultV2 = {
      summary: "Shortlist, research, then draft an intro.",
      steps: [
        {
          key: "shortlist",
          role: "DISCOVERY",
          goal: "Shortlist the best fits",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "intro",
          role: "CONVERSATION",
          goal: "Prepare an intro for approval; do not send it",
          tools: ["list_messages"],
          dependsOn: ["shortlist"],
        },
      ],
      cannot: [],
    };
    const fixed: JobPlanResultV2 = {
      summary: "Shortlist, then express interest in the strongest fit.",
      steps: [
        {
          key: "shortlist",
          role: "DISCOVERY",
          goal: "Shortlist the best fits",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "reach",
          role: "OUTREACH",
          goal: "Express interest in the strongest fit",
          tools: ["relationship.interest.express"],
          dependsOn: ["shortlist"],
        },
      ],
      cannot: [
        "Writing a first introduction message: Q only answers people who already wrote.",
      ],
    };
    const { board, plans } = world(true, [readOnly, fixed]);
    const prepared = await board.port.prepare(
      actor,
      "run-r",
      "Draft an intro to the strongest fit",
    );
    expect(prepared.status).toBe("PREPARED");
    expect(plans()).toBe(2);
    const proposal = await board.proposer.propose({
      runId: "run-r",
      actor,
    } as unknown as Parameters<typeof board.proposer.propose>[0]);
    if (proposal === null || "refused" in proposal) throw new Error("none");
    const payload = WorkforceJobStartPayloadSchema.parse(proposal.payload);
    expect(payload.steps.map((step) => [step.role, step.tools])).toEqual([
      ["MANDATE_WATCHER", ["search_companies"]],
      ["OUTREACH", ["relationship.interest.express"]],
    ]);
  });

  it("never offers a plan with a step no registered executor can run (D1)", async () => {
    const { board, plans } = world(true, UNRUNNABLE);
    const prepared = await board.port.prepare(actor, "run-u", "Make a deck");
    expect(prepared.status).toBe("NOT_PLANNED");
    // Refused, the lead replans once with code's reasons; still refused,
    // nothing is offered.
    expect(plans()).toBe(2);
    expect(
      await board.proposer.propose({
        runId: "run-u",
        actor,
      } as unknown as Parameters<typeof board.proposer.propose>[0]),
    ).toBeNull();
  });

  it("runs a plan approved before the registry with its writer and reviewer folded into the sender", () => {
    const planned = plannedFrom({
      ownerUserId: userId,
      goal: "Reply to Zino",
      summary: "Reply",
      steps: [
        {
          key: "draft",
          role: "WRITER",
          agentName: "Writer",
          goal: "Draft",
          tools: [],
          dependsOn: [],
          budgetUsd: "0.1",
          spawned: false,
        },
        {
          key: "grade",
          role: "REVIEWER",
          agentName: "Reviewer",
          goal: "Grade",
          tools: [],
          dependsOn: ["draft"],
          budgetUsd: "0.1",
          spawned: false,
        },
        {
          key: "reply",
          role: "CONVERSATION",
          agentName: "Conversation",
          goal: "Send the reply",
          tools: ["list_messages", "chat.message.send"],
          dependsOn: ["grade"],
          budgetUsd: "0.1",
          spawned: false,
        },
      ],
      permitted: ["list_messages", "chat.message.send"],
      budgetUsd: "0.5",
      cannot: [],
    });
    expect(planned.steps).toMatchObject([
      { key: "reply", executor: "CONVERSATION", dependsOn: [] },
    ]);
  });

  it("never runs a tool the approved grant does not hold", () => {
    const planned = plannedFrom({
      ownerUserId: userId,
      goal: "x",
      summary: "x",
      steps: [
        {
          key: "a",
          role: "OUTREACH",
          agentName: "Outreach",
          goal: "x",
          tools: ["relationship.interest.express", "chat.message.send"],
          dependsOn: [],
          budgetUsd: "0.1",
          spawned: false,
        },
      ],
      permitted: ["relationship.interest.express"],
      budgetUsd: "0.5",
      cannot: [],
    });
    expect(planned.steps[0]?.tools).toEqual(["relationship.interest.express"]);
  });

  it("at the month's limit, plans nothing and runs nothing", async () => {
    const { board, definition, store, expressed, plans } = world(false);
    expect(
      (await board.port.prepare(actor, "run-3", "Find me fits")).status,
    ).toBe("LIMIT_REACHED");
    expect(plans()).toBe(0);
    const payload = WorkforceJobStartPayloadSchema.parse({
      ownerUserId: userId,
      goal: "Find me fits",
      summary: "Fits",
      steps: [
        {
          key: "watch",
          role: "MANDATE_WATCHER",
          agentName: "Mandate watcher",
          goal: "Express interest",
          tools: ["relationship.interest.express"],
          dependsOn: [],
          budgetUsd: "0.05",
          spawned: false,
        },
      ],
      permitted: ["relationship.interest.express"],
      budgetUsd: "0.5",
      cannot: [],
    });
    await execute(definition, payload, actor);
    await vi.waitFor(() => {
      expect(store.rows.jobs[0]?.status).toBe("HELD");
    });
    expect(expressed).toEqual([]);
  });
});

describe("Q as a colleague on work (Q room R5)", () => {
  const waiting = [
    { summary: "Send Priya Raman at Fernhill: Would a 30-minute call work?" },
    {
      summary:
        "Send Jonas Weber at Clearwater Pay: Could you share the statements?",
    },
    { summary: "Update your round size to two million." },
  ];

  it("finds what already waits about the same people, by name, and nothing on a guess", () => {
    expect(
      relatedWaiting("Follow up with Priya and Jonas from the intros", waiting)
        .waiting,
    ).toHaveLength(2);
    expect(relatedWaiting("follow up with everyone", waiting).waiting).toEqual(
      [],
    );
    expect(
      relatedWaiting("Book a call with Kestrel Heat", waiting).waiting,
    ).toEqual([]);
  });

  const KESTREL = "6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
  const KESTREL_REL = "7b2a1d3f-4c5e-4f6a-9b0c-1d2e3f4a5b6c";
  const OTHER = "8c3b2e4a-5d6f-4a7b-8c9d-2e3f4a5b6c7d";
  const byIds = [
    {
      // Says nothing of Kestrel by name: only its target says who it is.
      summary: "Send the intro note we drafted last week",
      actionType: "message.send",
      targets: [{ kind: "RELATIONSHIP" as const, relationshipId: KESTREL_REL }],
    },
    {
      summary: "Share the data room",
      actionType: "document.share",
      targets: [{ kind: "COMPANY" as const, companyId: OTHER }],
    },
    {
      summary: "Q's team: Follow up with three investors",
      actionType: "q.workforce.job.start",
      targets: [{ kind: "USER" as const, userId }],
    },
  ];

  it("matches by the records the request resolves to, not only capitalised names (W4b)", () => {
    // "kestrel" lower-case: no capitalised name, but the search resolved it.
    const related = relatedWaiting("book a call with kestrel", byIds, [
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: KESTREL },
      { kind: "RELATIONSHIP", relationshipId: KESTREL_REL },
    ]);
    expect(related).toEqual({
      about: "SAME_PEOPLE",
      waiting: ["Send the intro note we drafted last week"],
    });
  });

  it("the same work is the same outward action on the same record, never two plans about nobody (F-84)", () => {
    const followUp = {
      outward: ["chat.message.send"],
      targets: [`relationship:${KESTREL_REL}`],
    };
    const withPlans = byIds.map((item) =>
      item.actionType === "q.workforce.job.start"
        ? { ...item, plan: followUp }
        : item,
    );
    // Same outward action, same record: the same work.
    expect(
      waitingSameWork(
        {
          outward: ["chat.message.send"],
          targets: [`relationship:${KESTREL_REL}`],
        },
        withPlans,
      ),
    ).toEqual(["Q's team: Follow up with three investors"]);
    // Same action about no record (F-84 live: "market research" held by
    // "warehouse controls"), a different action, or own work: none.
    expect(
      waitingSameWork(
        { outward: ["chat.message.send"], targets: [] },
        withPlans,
      ),
    ).toEqual([]);
    expect(
      waitingSameWork(
        {
          outward: ["schedule.meeting.book"],
          targets: [`relationship:${KESTREL_REL}`],
        },
        withPlans,
      ),
    ).toEqual([]);
    expect(
      waitingSameWork(
        { outward: [], targets: [`relationship:${KESTREL_REL}`] },
        withPlans,
      ),
    ).toEqual([]);
    // A card that is not a job: its action type is the outward action.
    expect(
      waitingSameWork(
        { outward: ["message.send"], targets: [`relationship:${KESTREL_REL}`] },
        byIds,
      ),
    ).toEqual(["Send the intro note we drafted last week"]);
  });

  it("plans first, and never holds work because a waiting card names the same people (F-84)", async () => {
    // Named alike, but nothing about what either would do: not held.
    const named = world(true, PLAN, waiting);
    const first = await named.board.port.prepare(
      actor,
      "run-w1",
      "Follow up with Priya and Jonas",
    );
    expect(first.status).toBe("PREPARED");
    expect(named.plans()).toBe(1);

    // The plan expresses interest in Kestrel, and a card expressing
    // interest in Kestrel is waiting: the same work, asked about first.
    const kestrel = world(true, PLAN, [
      {
        summary: "Express interest in Kestrel Heat",
        actionType: "relationship.interest.express",
        targets: [{ kind: "COMPANY", companyId: KESTREL }],
      },
    ]);
    const held = await kestrel.board.port.prepare(
      actor,
      "run-w2",
      "Express interest in Kestrel Heat",
      { subjects: [{ kind: "COMPANY", companyId: KESTREL }] } as never,
    );
    expect(held).toEqual({
      status: "ALREADY_WAITING",
      waiting: ["Express interest in Kestrel Heat"],
      about: "SAME_PEOPLE",
    });
    // Told to go ahead: planned and offered.
    const ahead = await kestrel.board.port.prepare(
      actor,
      "run-w3",
      "Express interest in Kestrel Heat",
      {
        proceed: true,
        subjects: [{ kind: "COMPANY", companyId: KESTREL }],
      } as never,
    );
    expect(ahead.status).toBe("PREPARED");
  });

  it("says what will need them, with the calendar when it is not connected", async () => {
    const { board } = world();
    const prepared = await board.port.prepare(actor, "run-n1", "Find me fits");
    if (prepared.status !== "PREPARED") throw new Error("not prepared");
    // Its steps send nothing outward (email is not a job tool).
    expect(prepared.plan.needsYou).toEqual([
      "Your approval of this plan before anything starts",
    ]);
    const payload = WorkforceJobStartPayloadSchema.parse({
      ownerUserId: userId,
      goal: "Book a call with Kestrel Heat",
      summary: "Book a call",
      steps: [
        {
          key: "call",
          role: "SCHEDULER",
          agentName: "Scheduler",
          goal: "Find a time and book it",
          tools: ["find_meeting_times", "schedule.meeting.book"],
          dependsOn: [],
          budgetUsd: "0.1",
          spawned: false,
        },
      ],
      permitted: ["find_meeting_times", "schedule.meeting.book"],
      budgetUsd: "0.5",
      cannot: [],
    });
    expect(needsYouFor(payload, false)).toEqual([
      "Your approval of this plan before anything starts",
      "Connect your Google Calendar, or I'll suggest times I can't check against it",
    ]);
    expect(needsYouFor(payload, true)).toHaveLength(1);
  });
});
