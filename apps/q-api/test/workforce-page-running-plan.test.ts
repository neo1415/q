import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createWorkforcePage } from "../src/composition/workforce/page.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";
import {
  createInMemoryWorkforceStore,
  type Owner,
} from "../src/composition/workforce/store.js";

/**
 * live5 (2026-11-04): /work's Moving said "Nothing running" while a plan
 * ran. A plan job's own work is done once it hands over its plan; once
 * that plan is approved or running, the job is listed as running work.
 */

const owner: Owner = { tenantId: randomUUID(), userId: randomUUID() };
const at = new Date("2026-11-04T21:00:00Z");

async function listWith(planStatus: string | null, kind = "PLAN") {
  const store = createInMemoryWorkforceStore();
  const { job } = await store.ensureJob(owner, {
    source: { kind: "JOB", id: "live5-plan" },
    goal: "Make me a plan to follow up with Ledgerline this week",
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
    planStatusOf: (who, jobId) => {
      asked.push(`${who.userId}:${jobId}`);
      return Promise.resolve(planStatus);
    },
  });
  const [item] = (await page.list(owner, { limit: 20 })).items;
  // /work renders each job's detail: the same standing there.
  const detail = await page.detail(owner, job.id);
  return { item, detail, asked, jobId: job.id };
}

describe("a plan job whose plan runs is moving work (live5)", () => {
  it("is listed as running once its plan is executing, with no finished work state", async () => {
    const { item, detail, asked, jobId } = await listWith("EXECUTING");
    expect(item?.status).toBe("RUNNING");
    expect(item?.workState).toBeUndefined();
    expect(detail?.job.status).toBe("RUNNING");
    expect(detail?.job.workState).toBeUndefined();
    expect(asked).toContain(`${owner.userId}:${jobId}`);
  });

  it("an approved plan about to run is running too", async () => {
    const { item } = await listWith("ACCEPTED");
    expect(item?.status).toBe("RUNNING");
    expect(item?.workState).toBeUndefined();
  });

  it("an offered plan stays as it was: it waits in Needs you", async () => {
    const { item } = await listWith("OFFERED");
    expect(item?.workState).toBe("COMPLETED");
  });

  it("a job that is not a plan job is never looked up", async () => {
    const { item, asked } = await listWith("EXECUTING", "RESEARCH");
    expect(item?.workState).toBe("COMPLETED");
    expect(asked).toEqual([]);
  });
});
