import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { WorkforceJobStartPayloadSchema } from "@capital-q/contracts";
import type { AnyQActionDefinition } from "@capital-q/q-actions";
import type { JobPlanResult } from "@capital-q/q-core";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createWorkforceJobActions,
  createWorkforceJobBoard,
  needsYouFor,
  plannedFrom,
  relatedWaiting,
} from "../src/composition/workforce/job-actions.js";
import {
  createWorkforceJobs,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
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

const PLAN: JobPlanResult = {
  summary: "Express interest in companies that fit your mandate.",
  steps: [
    {
      key: "watch",
      role: "MANDATE_WATCHER",
      agentName: null,
      goal: "Express interest in companies that fit",
      tools: ["search_companies", "relationship.interest.express"],
      dependsOn: [],
    },
    {
      key: "dig",
      role: "AD_HOC",
      agentName: "Interest helper",
      goal: "Express interest in one more",
      tools: ["relationship.interest.express", "email.send"],
      dependsOn: [],
    },
  ],
  cannot: [],
};

function world(withinLimit = true) {
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
          return Promise.resolve(PLAN);
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
      withinLimit: () => Promise.resolve(withinLimit),
    });
  const board = createWorkforceJobBoard({
    jobsFor,
    withinLimit: () => Promise.resolve(withinLimit),
  });
  const [definition] = createWorkforceJobActions({ jobsFor });
  if (definition === undefined) throw new Error("no action");
  return { store, expressed, board, definition, plans: () => plans };
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
  it("plans, shows the plan in plain words, and proposes it as the card", async () => {
    const { board } = world();
    const prepared = await board.port.prepare(actor, "run-1", "Find me fits");
    expect(prepared.status).toBe("PREPARED");
    if (prepared.status !== "PREPARED") throw new Error("not prepared");
    expect(prepared.plan.steps).toEqual([
      {
        who: "Mandate watcher",
        does: "Express interest in companies that fit",
      },
      { who: "Interest helper", does: "Express interest in one more" },
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
    const { board, definition, store, expressed, plans } = world();
    await board.port.prepare(actor, "run-2", "Find me fits");
    const proposal = await board.proposer.propose({
      runId: "run-2",
      actor,
    } as unknown as Parameters<typeof board.proposer.propose>[0]);
    if (proposal === null || "refused" in proposal) throw new Error("none");
    const payload = WorkforceJobStartPayloadSchema.parse(proposal.payload);
    // The helper got only the tools its step needs and the job permits.
    expect(payload.steps[1]).toMatchObject({
      role: "AD_HOC",
      spawned: true,
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
    expect(plans()).toBe(1);
    expect(expressed.every((one) => one.by === userId)).toBe(true);
    expect(expressed.length).toBeGreaterThan(0);
    expect(
      store.rows.runs
        .filter((run) => run.role === "AD_HOC")
        .map((r) => r.agent_name),
    ).toEqual(["Interest helper"]);
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

  it("a request naming nobody reports waiting jobs of the same kind (W4b)", () => {
    expect(relatedWaiting("follow up with everyone who wrote", byIds)).toEqual({
      about: "SAME_KIND",
      waiting: ["Q's team: Follow up with three investors"],
    });
  });

  it("asks before starting when work is already waiting, and plans once told to go ahead", async () => {
    const base = world();
    const board = createWorkforceJobBoard({
      jobsFor: () => {
        throw new Error("must not plan before asking");
      },
      waiting: () => Promise.resolve(waiting),
    });
    const first = await board.port.prepare(
      actor,
      "run-w1",
      "Follow up with Priya and Jonas",
    );
    expect(first).toEqual({
      status: "ALREADY_WAITING",
      waiting: [waiting[0]?.summary, waiting[1]?.summary],
      about: "SAME_PEOPLE",
    });
    expect(base.plans()).toBe(0);
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
