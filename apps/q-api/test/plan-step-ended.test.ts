import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Live e11 (2026-10-29): a plan's step job ended at 10:13 and its step
 * read "Started" until the ten-minute sweep wrote "Done" at 10:16. The
 * runner now tells the plan the moment the job's row has ended.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const owner = { tenantId: actor.tenantId, userId: actor.userId };

function world() {
  const queue = createInMemoryAgentWorkQueue();
  const told: { planId: string; state: string | undefined }[] = [];
  const runner = createAgentWorkRunner({
    queue,
    store: createInMemoryWorkforceStore(),
    actorFor: () => Promise.resolve(actor),
    jobsFor: () => {
      throw new Error("no job reaches the workforce here");
    },
    planStepEnded: async (who, planId) => {
      expect(who).toEqual(owner);
      // The row has ended before the plan is told (verifiedDone reads it).
      const [row] = await queue.forOwner(owner, [jobId]);
      told.push({ planId, state: row?.state });
    },
    workerId: "worker-e11",
  });
  const jobId = randomUUID();
  return { queue, runner, told, jobId };
}

describe("a plan step's job ends: its plan is re-evaluated at once (live e11)", () => {
  it("tells the plan the job belongs to, after the row has ended", async () => {
    const w = world();
    const planId = randomUUID();
    // A payload the runner cannot read ends the job (FAILED) at once.
    await w.queue.enqueue(owner, {
      jobId: w.jobId,
      plan: { not: "a plan" },
      trace: { planId },
    });
    await w.runner.pass();
    expect(w.told).toEqual([{ planId, state: "FAILED" }]);
  });

  it("a job of no plan tells nothing", async () => {
    const w = world();
    await w.queue.enqueue(owner, {
      jobId: w.jobId,
      plan: { not: "a plan" },
      trace: {},
    });
    await w.runner.pass();
    expect(w.told).toEqual([]);
  });
});
