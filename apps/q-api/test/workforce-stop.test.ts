import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { workFields } from "../src/composition/workforce/page.js";
import {
  createInMemoryAgentWorkQueue,
  workforceJobStopPort,
} from "../src/composition/workforce/queue.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Recovery D6: "Stop this job" (app action `q.work.job.stop`, Q's
 * `stop_q_job`) ends the person's own running job -- the work row
 * CANCELLED, the job STOPPED -- and the Work page reads the same row's
 * state, reason and trace.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const owner = { tenantId: actor.tenantId, userId: actor.userId };

async function queued() {
  const queue = createInMemoryAgentWorkQueue();
  const store = createInMemoryWorkforceStore();
  const filed = await store.ensureJob(owner, {
    source: { kind: "JOB", id: randomUUID() },
    goal: "Research five investors",
    budgetUsd: 0.5,
    threshold: 75,
    maxRedrafts: 1,
    rubricVersion: "workforce-rubric/v1",
  });
  const runId = randomUUID();
  const conversationId = randomUUID();
  await queue.enqueue(owner, {
    jobId: filed.job.id,
    plan: {},
    trace: { runId, conversationId, actionId: randomUUID() },
  });
  return { queue, store, jobId: filed.job.id, runId, conversationId };
}

describe("stop this job (D6)", () => {
  it("stops the person's own running job: CANCELLED work, STOPPED job, and the page says so", async () => {
    const w = await queued();
    const port = workforceJobStopPort(w.queue, w.store);
    expect(await port.stop(actor, w.jobId)).toBe(true);
    expect(w.queue.rows[0]?.state).toBe("CANCELLED");
    expect(w.store.rows.jobs[0]?.status).toBe("STOPPED");
    const [row] = await w.queue.forOwner(owner, [w.jobId]);
    expect(workFields(row)).toEqual({
      workState: "CANCELLED",
      stoppedBecause: "Stopped by you.",
      trace: { conversationId: w.conversationId, runId: w.runId },
    });
    // Again: nothing running to stop.
    expect(await port.stop(actor, w.jobId)).toBe(false);
  });

  it("never stops someone else's job", async () => {
    const w = await queued();
    const stranger = ActorContextSchema.parse({
      ...actor,
      userId: randomUUID(),
    });
    expect(
      await workforceJobStopPort(w.queue, w.store).stop(stranger, w.jobId),
    ).toBe(false);
    expect(w.queue.rows[0]?.state).toBe("QUEUED");
  });

  it("a live job shows its state without a reason; an unqueued job shows nothing", async () => {
    const w = await queued();
    const [row] = await w.queue.forOwner(owner, [w.jobId]);
    expect(workFields(row)).toMatchObject({ workState: "QUEUED" });
    expect(workFields(row).stoppedBecause).toBeUndefined();
    expect(workFields(undefined)).toEqual({});
  });
});
