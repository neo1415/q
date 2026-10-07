import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  WorkforceJobDetailDtoSchema,
  WorkforceOverviewDtoSchema,
} from "@capital-q/contracts";

import {
  withinMonthlyLimit,
  workforceMonthlyLimitUsd,
} from "../src/composition/workforce/limit.js";
import { createWorkforcePage } from "../src/composition/workforce/page.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * J5/J6: the workforce page's overview (who is on what today, this month's
 * spend by role against the limit) and the approval card an offered draft
 * waits on, read only for the person's own jobs.
 */

const OWNER = { tenantId: randomUUID(), userId: randomUUID() };
const OTHER = { tenantId: OWNER.tenantId, userId: randomUUID() };
const grade = {
  score: 87,
  passed: true,
  criteria: [],
  integrity: [],
  feedback: "",
};

async function seeded() {
  const store = createInMemoryWorkforceStore();
  const { job, leadRunId } = await store.ensureJob(OWNER, {
    source: { kind: "JOB", id: "job-1" },
    goal: "Intro to Kestrel Heat",
    budgetUsd: 0.5,
    threshold: 80,
    maxRedrafts: 2,
    rubricVersion: "rubric/v1",
  });
  const writer = await store.startRun(OWNER, {
    jobId: job.id,
    role: "WRITER",
    agentName: "Writer",
    goal: "Email to Priya",
    tools: [],
    budgetUsd: 0.1,
    stepKey: null,
    spawnedByRunId: leadRunId,
  });
  const reviewer = await store.startRun(OWNER, {
    jobId: job.id,
    role: "REVIEWER",
    agentName: "Reviewer",
    goal: "Grade",
    tools: [],
    budgetUsd: 0.1,
    stepKey: null,
    spawnedByRunId: leadRunId,
  });
  const draftId = await store.addDraft(OWNER, {
    jobId: job.id,
    writerRunId: writer,
    attempt: 1,
    parentDraftId: null,
    channel: "EMAIL",
    counterpartName: "Priya Shah",
    body: "Priya, 310 installs in a year is rare.",
  });
  await store.addGrade(OWNER, {
    jobId: job.id,
    draftId,
    reviewerRunId: reviewer,
    grade: { ...grade, score: 62, passed: false, failedIntegrity: [] },
    threshold: 80,
    maxRedrafts: 2,
    rubricVersion: "rubric/v1",
    promptVersion: "draft-review/v1",
  });
  const actionId = randomUUID();
  const approvalId = randomUUID();
  await store.addOutcome(OWNER, {
    jobId: job.id,
    draftId,
    outcome: "OFFERED",
    reason: null,
    qActionId: actionId,
  });
  store.rows.approvals.push({
    id: approvalId,
    action_id: actionId,
    status: "PENDING",
  });
  return { store, job, writer, reviewer, approvalId, leadRunId };
}

describe("the workforce overview and approval link (J5, J6)", () => {
  it("links an offered draft to its pending approval card", async () => {
    const { store, job, approvalId } = await seeded();
    const page = createWorkforcePage({ store });
    const detail = WorkforceJobDetailDtoSchema.parse(
      await page.detail(OWNER, job.id),
    );
    expect(detail.drafts[0]?.outcome).toMatchObject({
      outcome: "OFFERED",
      approvalId,
      approvalStatus: "PENDING",
    });
    // Someone else's id is the same as none.
    expect(await page.detail(OTHER, job.id)).toBeNull();
  });

  it("prices the month by role against the limit, and says who needs them", async () => {
    const { store, writer, reviewer } = await seeded();
    const page = createWorkforcePage({
      store,
      monthCosts: () =>
        Promise.resolve([
          { runId: writer, usd: "0.02" },
          { runId: reviewer, usd: "0.035" },
          { runId: randomUUID(), usd: "0.001" },
        ]),
      monthlyLimitUsd: () => Promise.resolve(0.05),
    });
    const overview = WorkforceOverviewDtoSchema.parse(
      await page.overview(OWNER),
    );
    expect(overview.spentUsd).toBe("0.056");
    expect(overview.limitUsd).toBe("0.05");
    expect(overview.paused).toBe(true);
    expect(overview.byRole.map((row) => row.role)).toEqual([
      "REVIEWER",
      "WRITER",
      "AD_HOC",
    ]);
    expect(overview.jobs).toEqual({ open: 1, needsYou: 1 });
    const reviewerRow = overview.team.find((row) => row.role === "REVIEWER");
    expect(reviewerRow).toMatchObject({
      drafts: 1,
      sentBack: 1,
      state: "WORKING",
    });
  });

  it("shows nothing spent when the ledger cannot be read", async () => {
    const { store } = await seeded();
    const page = createWorkforcePage({
      store,
      monthCosts: () => Promise.reject(new Error("ledger down")),
      monthlyLimitUsd: () => Promise.resolve(60),
    });
    const overview = await page.overview(OWNER);
    expect(overview).toMatchObject({
      spentUsd: "0",
      limitUsd: "60",
      paused: false,
    });
    const theirs = await page.overview(OTHER);
    expect(theirs.team).toEqual([]);
  });

  it("reads the monthly limit from configuration, with a safe default", async () => {
    expect(workforceMonthlyLimitUsd({})).toBe(60);
    expect(
      workforceMonthlyLimitUsd({ Q_WORKFORCE_MONTHLY_LIMIT_USD: "25" }),
    ).toBe(25);
    expect(
      workforceMonthlyLimitUsd({ Q_WORKFORCE_MONTHLY_LIMIT_USD: "none" }),
    ).toBeNull();
    expect(
      workforceMonthlyLimitUsd({ Q_WORKFORCE_MONTHLY_LIMIT_USD: "-1" }),
    ).toBe(60);
    expect(
      await withinMonthlyLimit(() => Promise.resolve([{ usd: "59.99" }]), 60),
    ).toBe(true);
    expect(
      await withinMonthlyLimit(() => Promise.resolve([{ usd: "60" }]), 60),
    ).toBe(false);
    expect(
      await withinMonthlyLimit(() => Promise.reject(new Error("x")), 60),
    ).toBe(true);
  });
});

describe("what the team map reads (Zino, 7 Oct: every agent read Idle)", () => {
  const NOW = new Date("2026-10-07T10:50:00Z");

  it("a pending card past its expiry reads EXPIRED, never asking", async () => {
    const { store, job, approvalId } = await seeded();
    const card = store.rows.approvals.find((one) => one.id === approvalId);
    if (card === undefined) throw new Error("seeded card missing");
    store.rows.approvals.splice(store.rows.approvals.indexOf(card), 1, {
      ...card,
      expires_at: new Date(NOW.getTime() - 60_000),
    });
    const page = createWorkforcePage({ store, now: () => NOW });
    const detail = WorkforceJobDetailDtoSchema.parse(
      await page.detail(OWNER, job.id),
    );
    expect(detail.drafts[0]?.outcome?.approvalStatus).toBe("EXPIRED");
  });

  it("reports live standing instructions: schedule, steps and where each card stands", async () => {
    const { store } = await seeded();
    const live = randomUUID();
    const lapsed = randomUUID();
    let since: Date | null = null;
    const step = (extra: Record<string, unknown>) => ({
      action: "chat.message.send",
      status: "ASKED",
      reason_code: null,
      words: "Waiting for your yes: Introduce Ledgerline",
      created_at: new Date("2026-10-07T08:03:57Z"),
      approval_id: null,
      approval_status: null,
      approval_expires_at: null,
      ...extra,
    });
    const page = createWorkforcePage({
      now: () => NOW,
      store: {
        ...store,
        instructions: (_owner, from) => {
          since = from;
          return Promise.resolve([
            {
              id: randomUUID(),
              goal_text: "  Express interest when a company fits  ",
              status: "ACTIVE",
              pause_reason: null,
              last_fired_at: new Date("2026-10-07T08:03:29Z"),
              next_fire_at: new Date("2026-10-07T12:03:29Z"),
              steps: [
                step({
                  approval_id: live,
                  approval_status: "PENDING",
                  approval_expires_at: new Date("2026-10-08T08:03:57Z"),
                }),
                step({
                  words: "Waiting for your yes: Introduce Spheros",
                  approval_id: lapsed,
                  approval_status: "PENDING",
                  approval_expires_at: new Date("2026-10-06T15:05:12Z"),
                }),
                step({
                  action: "q.note",
                  status: "NOTED",
                  reason_code: "QUESTION_FOR_YOU",
                  words: "Passed Tensorgate's question to you",
                }),
              ],
            },
          ]);
        },
      },
    });
    const overview = WorkforceOverviewDtoSchema.parse(
      await page.overview(OWNER),
    );
    expect(since).toEqual(new Date(NOW.getTime() - 24 * 60 * 60 * 1000));
    const [one] = overview.instructions ?? [];
    expect(one).toMatchObject({
      goal: "Express interest when a company fits",
      status: "ACTIVE",
      lastRunAt: "2026-10-07T08:03:29.000Z",
      nextRunAt: "2026-10-07T12:03:29.000Z",
    });
    expect(one?.steps.map((s) => s.approvalStatus)).toEqual([
      "PENDING",
      "EXPIRED",
      null,
    ]);
  });

  it("an unreadable instruction list shows none rather than failing the page", async () => {
    const { store } = await seeded();
    const page = createWorkforcePage({
      now: () => NOW,
      store: {
        ...store,
        instructions: () => Promise.reject(new Error("down")),
      },
    });
    const overview = WorkforceOverviewDtoSchema.parse(
      await page.overview(OWNER),
    );
    expect(overview.instructions).toEqual([]);
  });
});
