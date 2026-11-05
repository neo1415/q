import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createWorkforcePage,
  type RunningPlan,
} from "../src/composition/workforce/page.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";
import {
  createInMemoryWorkforceStore,
  type Owner,
} from "../src/composition/workforce/store.js";

/**
 * live5/live7 (2026-11-04/05): /work's Moving said "Nothing running" while
 * a plan ran, then listed it titled by the request ("Your plan: Make me a
 * plan to…") with no steps. A plan job's own work is done once it hands
 * over its plan; once that plan is approved or running, the job is listed
 * as running work, titled by the plan's goal, with the plan's steps.
 */

const owner: Owner = { tenantId: randomUUID(), userId: randomUUID() };
const at = new Date("2026-11-04T21:00:00Z");
const PLAN: RunningPlan = {
  goal: "Check Ledgerline's unit economics this week and reach an evidence-based view",
  steps: [
    {
      key: "s1",
      title: "Read Ledgerline's reported unit economics",
      why: "Its figures are self-reported.",
      owner: "Q",
      status: "DONE",
    },
    {
      key: "s2",
      title: "Prepare a Ledgerline request for the evidence",
      why: "The gaps need its figures.",
      owner: "Q",
      status: "PROPOSED",
    },
    {
      key: "s3",
      title: "Decide whether to advance, pause or pass",
      why: "Your call once the evidence is in.",
      owner: "YOU",
      status: "TODO",
    },
  ],
};

async function listWith(plan: RunningPlan | null, kind = "PLAN") {
  const store = createInMemoryWorkforceStore();
  const { job } = await store.ensureJob(owner, {
    source: { kind: "JOB", id: "live5-plan" },
    goal: "Your plan: Make me a plan to check Ledgerline's unit economics this week",
    budgetUsd: 0.5,
    threshold: 80,
    maxRedrafts: 2,
    rubricVersion: "rubric/v1",
  });
  const row: WorkRow = {
    job_id: job.id,
    tenant_id: owner.tenantId,
    user_id: owner.userId,
    state: "COMPLETED",
    plan: { kind },
    trace: {},
    results: {},
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: at,
    updated_at: at,
    finished_at: at,
  };
  const asked: string[] = [];
  const page = createWorkforcePage({
    store,
    work: { forOwner: () => Promise.resolve([row]) },
    runningPlanOf: (who, jobId) => {
      asked.push(`${who.userId}:${jobId}`);
      return Promise.resolve(plan);
    },
  });
  const { items } = await page.list(owner, { limit: 20 });
  // /work renders each job's detail: the same standing there.
  const detail = await page.detail(owner, job.id);
  return { items, detail, asked, jobId: job.id };
}

describe("a plan job whose plan runs is moving work (live5/live7)", () => {
  it("is listed once, as running, titled by the plan's goal, with its steps", async () => {
    const { items, detail, asked, jobId } = await listWith(PLAN);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("RUNNING");
    expect(items[0]?.workState).toBeUndefined();
    expect(items[0]?.goal).toBe(PLAN.goal);
    expect(detail?.job.goal).toBe(PLAN.goal);
    expect(detail?.job.workState).toBeUndefined();
    expect(
      detail?.plan?.steps.map((step) => [step.does, step.who, step.status]),
    ).toEqual([
      ["Read Ledgerline's reported unit economics", "Q", "DONE"],
      ["Prepare a Ledgerline request for the evidence", "Q", "HELD"],
      ["Decide whether to advance, pause or pass", "You", "WAITING"],
    ]);
    expect(detail?.plan?.done).toBe(1);
    expect(detail?.plan?.total).toBe(3);
    expect(asked).toContain(`${owner.userId}:${jobId}`);
  });

  it("a plan not approved or running (offered) stays as it was: it waits in Needs you", async () => {
    const { items, detail } = await listWith(null);
    expect(items[0]?.workState).toBe("COMPLETED");
    expect(items[0]?.goal).toMatch(/^Your plan: /u);
    expect(detail?.plan).toBeUndefined();
  });

  it("a job that is not a plan job is never looked up", async () => {
    const { items, asked } = await listWith(PLAN, "RESEARCH");
    expect(items[0]?.workState).toBe("COMPLETED");
    expect(asked).toEqual([]);
  });
});

describe("live8: a plan's step jobs are inside its row, never rows of their own", () => {
  it("lists the plan once and a job of no plan on its own; its step jobs not at all", async () => {
    const store = createInMemoryWorkforceStore();
    const file = (id: string, goal: string) =>
      store.ensureJob(owner, {
        source: { kind: "JOB", id },
        goal,
        budgetUsd: 0.5,
        threshold: 80,
        maxRedrafts: 2,
        rubricVersion: "rubric/v1",
      });
    const planId = randomUUID();
    const { job: planJob } = await file(
      "plan",
      "Your plan: Check Silo Credit's loan book quality this week",
    );
    const { job: research } = await file(
      `plan-step:${planId}:1:s1`,
      "Check Silo Credit's loan book quality this week: Research public evidence",
    );
    const { job: assess } = await file(
      `plan-step:${planId}:1:s2`,
      "Check Silo Credit's loan book quality this week: Assess Silo Credit's loan book",
    );
    const { job: alone } = await file("memo", "Research Kestrel Heat");
    const work = (
      jobId: string,
      state: WorkRow["state"],
      plan: unknown,
      trace: WorkRow["trace"],
    ): WorkRow => ({
      job_id: jobId,
      tenant_id: owner.tenantId,
      user_id: owner.userId,
      state,
      plan,
      trace,
      results: {},
      attempts: 1,
      max_attempts: 3,
      reason: null,
      created_at: at,
      updated_at: at,
      finished_at: null,
    });
    const rows = [
      work(planJob.id, "COMPLETED", { kind: "PLAN" }, {}),
      work(research.id, "RUNNING", { goal: "Research" }, { planId }),
      work(assess.id, "QUEUED", { goal: "Assess" }, { planId }),
      work(alone.id, "RUNNING", { goal: "Memo" }, {}),
    ];
    const page = createWorkforcePage({
      store,
      work: { forOwner: () => Promise.resolve(rows) },
      runningPlanOf: (_who, jobId) =>
        Promise.resolve(jobId === planJob.id ? PLAN : null),
    });
    const { items } = await page.list(owner, { limit: 20 });
    expect(items.map((item) => item.id).sort()).toEqual(
      [planJob.id, alone.id].sort(),
    );
    expect(items.find((item) => item.id === planJob.id)?.goal).toBe(PLAN.goal);
  });
});
