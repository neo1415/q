import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { WorkforceJobStartPayloadSchema } from "@capital-q/contracts";
import type { AnyQActionDefinition } from "@capital-q/q-actions";
import type { JobPlanResult } from "@capital-q/q-core";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createWorkforceJobActions,
  createWorkforceJobBoard,
  plannedFrom,
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
    expect(
      await definition.authorize(payload, stranger, {}),
    ).toMatchObject({ outcome: "DENY" });

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
