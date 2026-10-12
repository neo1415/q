import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  QArtifactDetailSchema,
  QApprovalViewSchema,
  Q_CONTRACT_VERSION,
  type QApprovalView,
} from "@capital-q/contracts";
import { createWorkforcePage } from "../src/composition/workforce/page.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";

const owner = { tenantId: randomUUID(), userId: randomUUID() };
const organisationId = randomUUID();
const artifactId = randomUUID();
const at = new Date("2026-10-12T07:00:00Z");
const document = QArtifactDetailSchema.parse({
  artifact: {
    artifactId,
    type: "MEMO",
    status: "READY",
    title: "Investment memo",
    currentVersion: 2,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  },
  current: {
    artifactId,
    version: 2,
    title: "Investment memo",
    summary: "Evidence and open questions.",
    content: { sections: [{ heading: "Evidence", body: "Stated evidence." }] },
    createdAt: at.toISOString(),
  },
  history: [
    { version: 2, title: "Investment memo", createdAt: at.toISOString() },
  ],
});
const current = document.current;
if (current === undefined)
  throw new Error("Expected the fixture's real version");

async function setup() {
  const store = createInMemoryWorkforceStore();
  const { job } = await store.ensureJob(owner, {
    source: { kind: "JOB", id: "deliverable-job" },
    goal: "Research, prepare and review a memo",
    budgetUsd: 0.5,
    threshold: 80,
    maxRedrafts: 2,
    rubricVersion: "rubric/v1",
  });
  const result = { status: "DONE", outputs: { artifactId } };
  const row: WorkRow = {
    job_id: job.id,
    tenant_id: owner.tenantId,
    user_id: owner.userId,
    state: "COMPLETED",
    plan: {},
    trace: { organisationId },
    results: { memo: result, critique: result },
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: at,
    updated_at: at,
    finished_at: at,
  };
  const forOwner = vi.fn(() => Promise.resolve([row]));
  const approvals: QApprovalView[] = [];
  const deliverables = vi.fn(() =>
    Promise.resolve({ documents: [document], approvals }),
  );
  return { store, job, row, forOwner, deliverables };
}

describe("workforce document deliverables", () => {
  it("returns only the job's native pending action under the same fresh owner read", async () => {
    const fixture = await setup();
    const actionId = randomUUID();
    const pending = QApprovalViewSchema.parse({
      contractVersion: Q_CONTRACT_VERSION,
      approvalId: randomUUID(),
      runId: randomUUID(),
      status: "PENDING",
      requestedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + 60_000).toISOString(),
      canDecide: true,
      action: {
        actionId,
        actionType: "app.diligence.questions.send",
        actionVersion: 1,
        actionClass: "CONFIRM_REQUIRED",
        actionStatus: "AWAITING_APPROVAL",
        targets: [{ kind: "COMPANY", companyId: randomUUID() }],
        summary: "Send founder questions",
        preview: "What evidence supports the retention claim?",
      },
    });
    fixture.forOwner.mockResolvedValue([
      {
        ...fixture.row,
        results: {
          ...fixture.row.results,
          diligence: { status: "DONE", outputs: { qActionId: actionId } },
        },
      },
    ]);
    fixture.deliverables.mockResolvedValue({
      documents: [document],
      approvals: [pending],
    });
    const page = createWorkforcePage({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      deliverables: fixture.deliverables,
    });
    expect((await page.detail(owner, fixture.job.id))?.approvals).toEqual([
      pending,
    ]);
    expect(fixture.deliverables).toHaveBeenCalledExactlyOnceWith(
      owner,
      organisationId,
      { artifactIds: [artifactId], actionIds: [actionId] },
    );
    fixture.deliverables.mockResolvedValue({
      documents: [document],
      approvals: [
        QApprovalViewSchema.parse({
          ...pending,
          action: { ...pending.action, actionId: randomUUID() },
        }),
      ],
    });
    const hidden = await page.detail(owner, fixture.job.id);
    expect(hidden?.approvals).toEqual([]);
    expect(hidden?.approvalsUnavailable).toBe(true);
  });
  it("resolves one canonical current document for preparation and critique outputs", async () => {
    const fixture = await setup();
    const page = createWorkforcePage({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      deliverables: fixture.deliverables,
    });
    const detail = await page.detail(owner, fixture.job.id);
    expect(detail?.documents).toEqual([document.artifact]);
    expect(detail?.documentsUnavailable).toBe(false);
    expect(fixture.deliverables).toHaveBeenCalledExactlyOnceWith(
      owner,
      organisationId,
      { artifactIds: [artifactId], actionIds: [] },
    );
  });

  it("never shows PREPARING or a READY pointer without a real matching version", async () => {
    const fixture = await setup();
    const deliverables = vi.fn(() =>
      Promise.resolve({
        documents: [
          { ...document, current: undefined },
          {
            ...document,
            artifact: { ...document.artifact, status: "PREPARING" as const },
          },
          { ...document, current: { ...current, version: 1 } },
        ],
        approvals: [],
      }),
    );
    const page = createWorkforcePage({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      deliverables,
    });
    const detail = await page.detail(owner, fixture.job.id);
    expect(detail?.documents).toEqual([]);
    expect(detail?.documentsUnavailable).toBe(true);
  });

  it("never resolves another person's job or an unreferenced artifact", async () => {
    const fixture = await setup();
    const page = createWorkforcePage({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      deliverables: fixture.deliverables,
    });
    expect(
      await page.detail({ ...owner, userId: randomUUID() }, fixture.job.id),
    ).toBeNull();
    expect(
      await page.detail({ ...owner, tenantId: randomUUID() }, fixture.job.id),
    ).toBeNull();
    expect(fixture.deliverables).not.toHaveBeenCalled();
    fixture.deliverables.mockResolvedValue({
      documents: [
        QArtifactDetailSchema.parse({
          ...document,
          artifact: { ...document.artifact, artifactId: randomUUID() },
        }),
      ],
      approvals: [],
    });
    const detail = await page.detail(owner, fixture.job.id);
    expect(detail?.documents).toEqual([]);
    expect(detail?.documentsUnavailable).toBe(true);
  });

  it("keeps an unreadable document visibly unavailable without exposing its contents", async () => {
    const fixture = await setup();
    fixture.deliverables.mockRejectedValue(new Error("Access was revoked"));
    const page = createWorkforcePage({
      store: fixture.store,
      work: { forOwner: fixture.forOwner },
      deliverables: fixture.deliverables,
    });
    const detail = await page.detail(owner, fixture.job.id);
    expect(detail?.documents).toEqual([]);
    expect(detail?.documentsUnavailable).toBe(true);
  });
});
