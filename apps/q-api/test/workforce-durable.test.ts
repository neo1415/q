import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WorkforceJobStartPayload } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  createWorkforceJobs,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import { createInMemoryAgentWorkQueue } from "../src/composition/workforce/queue.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createAgentWorkRunner } from "../src/composition/workforce/runner.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Recovery D3 (audit D-08): an approved job is durable work. A worker that
 * dies mid-job leaves a lease that lapses; the next pass reclaims the row,
 * resumes without redoing a finished step, and the row ends in a terminal
 * work state. A job out of attempts ends FAILED with the reason; a job the
 * person stopped never runs.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const owner = { tenantId: actor.tenantId, userId: actor.userId };

function payload(): WorkforceJobStartPayload {
  return {
    ownerUserId: actor.userId,
    goal: "Express interest in companies that fit my mandate.",
    summary: "Shortlist and reach out.",
    steps: [
      {
        key: "discover",
        role: "MANDATE_WATCHER",
        agentName: "Mandate watcher",
        goal: "Shortlist fits",
        tools: ["search_companies"],
        dependsOn: [],
        budgetUsd: "0.05",
        spawned: false,
      },
      {
        key: "reach",
        role: "OUTREACH",
        agentName: "Outreach",
        goal: "Express interest",
        tools: ["relationship.interest.express"],
        dependsOn: ["discover"],
        budgetUsd: "0.1",
        spawned: false,
      },
    ],
    permitted: ["search_companies", "relationship.interest.express"],
    budgetUsd: "0.5",
    cannot: [],
  };
}

function world() {
  let clock = Date.parse("2026-10-08T12:00:00.000Z");
  const queue = createInMemoryAgentWorkQueue(() => clock);
  const store = createInMemoryWorkforceStore();
  const record = { scans: 0, expressed: [] as string[] };
  const ports: WorkforcePorts = {
    principalName: () => Promise.resolve("Ada"),
    mandateMatches: () => {
      record.scans += 1;
      return Promise.resolve([{ companyId: "c-new", name: "New Co" }]);
    },
    expressInterest: (_owner, companyId) => {
      record.expressed.push(companyId);
      return Promise.resolve({ ok: true });
    },
    openConversations: () => Promise.resolve([]),
    writeReply: () => Promise.resolve(null),
    send: () => Promise.resolve(false),
    freeSlots: () => Promise.resolve([]),
    book: () => Promise.resolve({ ok: false, meetingId: null }),
    notify: () => Promise.resolve(),
  };
  const jobsFor = () =>
    createWorkforceJobs({
      store,
      models: {
        plan: () => Promise.resolve(null),
        readReply: () => Promise.resolve(null),
      },
      review: createOutwardReview({
        store,
        models: {
          review: () => Promise.resolve(null),
          redraft: () => Promise.resolve(null),
        },
      }),
      ports,
    });
  const runner = createAgentWorkRunner({
    queue,
    store,
    actorFor: (who) =>
      Promise.resolve(who.userId === actor.userId ? actor : null),
    jobsFor,
    workerId: "worker-2",
    leaseMs: 60_000,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { queue, store, record, runner, advance, jobsFor };
}

async function approved(w: ReturnType<typeof world>) {
  const actionId = randomUUID();
  const filed = await w.jobsFor().file(owner, {
    goal: payload().goal,
    budgetUsd: 0.5,
    source: { kind: "JOB", id: actionId },
  });
  await w.queue.enqueue(owner, {
    jobId: filed.jobId,
    plan: payload(),
    trace: { actionId, organisationId: actor.organisationId },
  });
  return { jobId: filed.jobId, actionId };
}

describe("durable workforce jobs (recovery D3)", () => {
  it("resumes a job a restart left behind: the finished step is not redone, the job completes", async () => {
    const w = world();
    const { jobId } = await approved(w);
    // Worker 1 claims it, finishes "discover", starts "reach" ... and dies.
    const [held] = await w.queue.claim("worker-1", 60_000, 1);
    expect(held?.state).toBe("RUNNING");
    await w.queue.recordStep(jobId, "worker-1", "discover", {
      status: "DONE",
      summary: "Shortlisted 1 company.",
      outputs: { shortlist: [{ companyId: "c-shortlisted", name: "Kestrel" }] },
    });
    const lead = w.store.rows.runs.find((run) => run.role === "LEAD");
    await w.store.startRun(owner, {
      jobId,
      role: "OUTREACH",
      agentName: "Outreach",
      goal: "Express interest",
      tools: ["relationship.interest.express"],
      budgetUsd: 0.1,
      stepKey: "reach",
      spawnedByRunId: lead?.id ?? null,
    });

    // Its lease is still live: nobody else takes it.
    expect(await w.runner.pass()).toBe(0);
    w.advance(61_000);
    expect(await w.runner.pass()).toBe(1);

    const row = w.queue.rows.find((one) => one.job_id === jobId);
    expect(row?.state).toBe("COMPLETED");
    expect(row?.finished_at).not.toBeNull();
    expect(row?.attempts).toBe(2);
    // The shortlist from before the restart was used; discovery not redone.
    expect(w.record.expressed).toEqual(["c-shortlisted"]);
    expect(w.record.scans).toBe(0);
    expect(w.store.rows.jobs.find((job) => job.id === jobId)?.status).toBe(
      "DONE",
    );
    // The step the restart interrupted is ended, with why; none left RUNNING.
    expect(
      w.store.rows.runs.filter(
        (run) => run.job_id === jobId && run.status === "RUNNING",
      ),
    ).toEqual([]);
    expect(
      w.store.rows.runs.some(
        (run) =>
          run.status === "FAILED" &&
          (run.summary ?? "").includes("Interrupted when Q restarted"),
      ),
    ).toBe(true);
  });

  it("ends a job FAILED, with the reason, once it is out of attempts", async () => {
    const w = world();
    const { jobId } = await approved(w);
    for (const worker of ["w-a", "w-b", "w-c"]) {
      await w.queue.sweep();
      await w.queue.claim(worker, 60_000, 1);
      w.advance(61_000);
    }
    expect(await w.runner.pass()).toBe(0);
    const row = w.queue.rows.find((one) => one.job_id === jobId);
    expect(row?.state).toBe("FAILED");
    expect(row?.reason).toContain("stopped after 3 tries");
    expect(w.store.rows.jobs.find((job) => job.id === jobId)?.status).toBe(
      "FAILED",
    );
    expect(w.record.expressed).toEqual([]);
  });

  it("never runs a job the person stopped, and only the owner can stop it", async () => {
    const w = world();
    const { jobId } = await approved(w);
    expect(
      await w.queue.cancel({ ...owner, userId: randomUUID() }, jobId),
    ).toBe(false);
    expect(await w.queue.cancel(owner, jobId)).toBe(true);
    expect(await w.runner.pass()).toBe(0);
    expect(w.queue.rows[0]?.state).toBe("CANCELLED");
    expect(w.record.expressed).toEqual([]);
  });

  it("blocks, with the reason, a job whose approver can no longer act", async () => {
    const w = world();
    const other = { tenantId: owner.tenantId, userId: randomUUID() };
    const filed = await w.jobsFor().file(other, {
      goal: "x",
      budgetUsd: 0.5,
      source: { kind: "JOB", id: randomUUID() },
    });
    await w.queue.enqueue(other, {
      jobId: filed.jobId,
      plan: { ...payload(), ownerUserId: other.userId },
      trace: {},
    });
    await w.runner.pass();
    expect(w.queue.rows[0]?.state).toBe("BLOCKED");
    expect(w.queue.rows[0]?.reason).toContain("no longer act");
  });
});
