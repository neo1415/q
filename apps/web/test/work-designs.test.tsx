// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QApprovalViewSchema,
  QWorkDetailDtoSchema,
  WorkforceJobDetailDtoSchema,
  WorkforceOverviewDtoSchema,
  type NotificationDto,
} from "@capital-q/contracts";

const stop = vi.fn<(id: string, lane: string | null) => Promise<unknown>>();
const paused = vi.fn<(id: string, value: boolean) => Promise<unknown>>();
vi.mock("../src/features/work/work-actions", () => ({
  stopWorkAction: (id: string, lane: string | null) => stop(id, lane),
  markReadAction: () => Promise.resolve({ ok: true, value: null }),
  answerWorkAction: () => Promise.resolve({ ok: true, value: null }),
}));
vi.mock("../src/features/work/work-page-actions", () => ({
  setPausedAction: (id: string, value: boolean) => paused(id, value),
  stopJobAction: () => Promise.resolve({ ok: true, value: null }),
  dismissSuggestionAction: () => Promise.resolve({ ok: true, value: null }),
  preparedAction: () => Promise.resolve({ ok: false, message: "x" }),
}));
vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: () => Promise.resolve({ ok: true, value: null }),
  rejectQApprovalAction: () => Promise.resolve({ ok: true, value: null }),
  readQApprovalAction: () => Promise.resolve({ ok: false }),
  askQAction: () => Promise.resolve({ ok: false }),
}));
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { railGroups } = await import("../src/features/work/notice-groups");
const { jobPlan, instructionPlan, planEntries } =
  await import("../src/features/work/work-plan");
const { costDays, costByJob, WorkCostDays } =
  await import("../src/features/work/work-cost-days");
const { DelegationAudit } =
  await import("../src/features/work/delegation-audit");
const { WorkPlanView } = await import("../src/features/work/work-plan-view");

afterEach(() => {
  cleanup();
  stop.mockReset();
  paused.mockReset();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// The notification rail, by investor
// ---------------------------------------------------------------------------

function notice(over: Partial<NotificationDto>): NotificationDto {
  return {
    id: id(Math.floor(Math.random() * 1e9)),
    kind: "Q_WORK",
    title: "A notice",
    body: null,
    linkPath: null,
    read: false,
    createdAt: "2026-10-20T10:00:00Z",
    priority: "UPDATE",
    ...over,
  };
}

describe("the notification rail groups by who it is about (option 3)", () => {
  const NORTHMOOR = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: id(1),
    photoUrl: null,
  };
  const SABLE = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: id(2),
    photoUrl: null,
  };
  const now = new Date("2026-10-20T20:00:00Z");

  it("puts each organisation once, what needs the person first, Q's own last", () => {
    const groups = railGroups(
      [
        notice({
          title: "Sable opened your deck",
          named: SABLE,
          createdAt: "2026-10-20T12:00:00Z",
        }),
        notice({
          title: "Today's Q Daily is ready",
          createdAt: "2026-10-20T07:30:00Z",
        }),
        notice({
          title: "Reply to Mina is ready for your yes",
          named: NORTHMOOR,
          priority: "NEEDS_YOU",
          createdAt: "2026-10-20T09:00:00Z",
        }),
        notice({
          title: "Northmoor signed the NDA",
          named: NORTHMOOR,
          read: true,
        }),
      ],
      { [NORTHMOOR.id]: "Northmoor Capital" },
      now,
    );
    expect(groups.map((group) => group.name)).toEqual([
      "Northmoor Capital",
      // A name the person's own relationships don't give stays unknown.
      null,
      null,
    ]);
    expect(groups[0]?.needsYou.map((one) => one.notice.title)).toEqual([
      "Reply to Mina is ready for your yes",
    ]);
    expect(groups[0]?.updates.map((one) => one.notice.title)).toEqual([
      "Northmoor signed the NDA",
    ]);
    expect(groups[2]?.key).toBe("q");
  });
});

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

function approval(approvalId: string, summary: string) {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId,
    runId: id(90),
    status: "PENDING",
    requestedAt: "2026-10-20T09:07:00Z",
    expiresAt: "2026-10-21T09:07:00Z",
    canDecide: true,
    action: {
      actionId: id(91),
      actionType: "chat.message.send",
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: "AWAITING_APPROVAL",
      targets: [{ kind: "COMPANY", companyId: id(92) }],
      summary,
      preview: "Hi Mina, the unit economics are on tab 3.",
    },
  });
}

function job(over: {
  readonly status?: "RUNNING" | "DONE" | "HELD";
  readonly approvals?: readonly ReturnType<typeof approval>[];
  readonly plan?: unknown;
}) {
  return WorkforceJobDetailDtoSchema.parse({
    job: {
      id: id(10),
      goal: "Answer Northmoor’s diligence questions",
      source: "JOB",
      status: over.status ?? "RUNNING",
      reviewBar: { threshold: 70, maxRedrafts: 2, rubricVersion: "r1" },
      budgetUsd: "2",
      costUsd: "1.9",
      agents: 2,
      drafts: 1,
      held: 0,
      createdAt: "2026-10-20T09:00:00Z",
      updatedAt: "2026-10-20T09:07:00Z",
    },
    agents: [
      {
        id: id(11),
        role: "RESEARCH",
        agentName: "Research",
        goal: "Find the figures",
        tools: [],
        status: "DONE",
        summary: "Both are in the model, tabs 3 and 5.",
        spawnedByRunId: null,
        spawned: false,
        budgetUsd: "0.5",
        costUsd: "0.38",
        startedAt: "2026-10-20T09:03:00Z",
        endedAt: "2026-10-20T09:04:00Z",
      },
    ],
    drafts: [],
    timeline: [],
    ...(over.approvals === undefined ? {} : { approvals: over.approvals }),
    ...(over.plan === undefined ? {} : { plan: over.plan }),
  });
}

const PLAN = {
  outcome: "Mina has the unit economics she asked for, by Thursday.",
  done: 1,
  total: 3,
  steps: [
    {
      key: "s1",
      who: "Research",
      does: "Find the figures",
      why: "Mina asked for them",
      status: "DONE",
      summary: "Both are in the model, tabs 3 and 5.",
      dependsOn: [],
      fallbackFor: null,
      evidence: [
        {
          ref: "F1",
          kind: "MESSAGE_WAITING",
          text: "Mina’s message, 18 Oct",
          at: null,
        },
      ],
    },
    {
      key: "s2",
      who: "Writer",
      does: "Write the reply",
      why: null,
      status: "WAITING",
      summary: null,
      dependsOn: ["s1"],
      fallbackFor: null,
      evidence: [],
    },
    {
      key: "s3",
      who: "Scheduler",
      does: "Offer times",
      why: null,
      status: "WAITING",
      summary: null,
      dependsOn: ["s2"],
      fallbackFor: null,
      evidence: [],
    },
  ],
  prerequisites: [
    {
      what: "Mina’s preferred call time",
      status: "UNKNOWN",
      blocking: false,
      evidence: [],
      resolvedBy: null,
    },
    {
      what: "The model",
      status: "MET",
      blocking: true,
      evidence: [],
      resolvedBy: null,
    },
  ],
  signals: [
    {
      kind: "CONTRADICTION",
      note: "The deck says 3 pilots, the model lists 4.",
      stepKey: "s1",
    },
  ],
  nextActions: [],
  situation: [],
};

describe("the plan (How Q is handling it, option 2)", () => {
  it("reads each step from the server's progress, with its worker and evidence", () => {
    const entry = jobPlan(job({ plan: PLAN }));
    expect(entry.goal).toBe(PLAN.outcome);
    expect(entry.steps.map((step) => [step.title, step.state])).toEqual([
      ["Find the figures", "done"],
      // The first waiting step whose inputs are done is the one running.
      ["Write the reply", "now"],
      ["Offer times", "next"],
    ]);
    expect(entry.steps[0]).toMatchObject({
      who: "Research",
      did: "Both are in the model, tabs 3 and 5.",
      based: ["Mina’s message, 18 Oct"],
    });
    // Two figures that disagree are both kept, never one picked.
    expect(entry.contradictions).toEqual([
      "The deck says 3 pilots, the model lists 4.",
    ]);
    // What is met is not missing; what is not known says so.
    expect(entry.missing).toEqual([
      expect.objectContaining({
        what: "Mina’s preferred call time",
        status: "UNKNOWN",
      }),
    ]);
  });

  it("puts the yes it waits on after the done steps, and nothing else runs meanwhile", () => {
    const waiting = approval(id(20), "Reply to Mina with the unit economics");
    const entry = jobPlan(job({ plan: PLAN, approvals: [waiting] }));
    expect(entry.state).toBe("Waiting for your yes");
    expect(entry.waiting).toBe(true);
    expect(entry.steps.map((step) => [step.title, step.state])).toEqual([
      ["Find the figures", "done"],
      ["Your yes", "now"],
      ["Write the reply", "next"],
      ["Offer times", "next"],
    ]);
    expect(entry.steps[1]?.approvalId).toBe(id(20));
    expect(entry.approvals.get(id(20))).toEqual(waiting);
  });

  it("falls back to the runs for a job without a plan", () => {
    const entry = jobPlan(job({}));
    expect(entry.steps).toEqual([
      expect.objectContaining({
        title: "Find the figures",
        state: "done",
        who: "Research",
      }),
    ]);
  });

  it("reads a standing instruction's day, with its waiting card and its next run", () => {
    const entry = instructionPlan({
      id: id(30),
      goal: "Answer scheduling questions while I’m away",
      status: "ACTIVE",
      pauseReason: null,
      lastRunAt: "2026-10-20T09:00:00Z",
      nextRunAt: "2026-10-20T15:00:00Z",
      steps: [
        {
          action: "chat.message.send",
          status: "ASKED",
          reasonCode: null,
          words: "Asked you before replying to Jo",
          at: "2026-10-20T09:01:00Z",
          approvalId: id(31),
          approvalStatus: "PENDING",
        },
        {
          action: "chat.message.send",
          status: "DONE",
          reasonCode: "DELEGATED",
          words: "Answered Sable on team size",
          at: "2026-10-20T08:00:00Z",
          approvalId: null,
          approvalStatus: null,
        },
      ],
    });
    expect(entry.state).toBe("Waiting for your yes");
    expect(entry.steps.map((step) => [step.title, step.state])).toEqual([
      ["Answered Sable on team size", "done"],
      ["Asked you before replying to Jo", "now"],
      ["Next run", "next"],
    ]);
    expect(entry.steps[1]?.approvalId).toBe(id(31));
  });

  it("lists what waits for the person first", () => {
    const entries = planEntries({
      jobs: [
        job({ status: "DONE" }),
        job({ approvals: [approval(id(21), "x")] }),
      ],
      instructions: [],
    });
    expect(entries[0]?.waiting).toBe(true);
  });

  it("opens the waiting step's exact card from the plan", async () => {
    const waiting = approval(id(22), "Reply to Mina with the unit economics");
    const detail = job({ plan: PLAN, approvals: [waiting] });
    render(
      <WorkPlanView
        view={{
          overview: WorkforceOverviewDtoSchema.parse({
            month: "2026-10",
            spentUsd: "1.9",
            limitUsd: "40",
            paused: false,
            byRole: [],
            team: [],
            jobs: { open: 1, needsYou: 1 },
          }),
          jobs: [detail],
        }}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText("Two figures disagree")).toBeTruthy();
    expect(screen.getByText("Mina’s preferred call time")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review the reply" }));
    await settle();
    expect(
      screen.getByText("Hi Mina, the unit economics are on tab 3."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve and send" }),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Cost, day by day
// ---------------------------------------------------------------------------

function overview(byDay: unknown) {
  return WorkforceOverviewDtoSchema.parse({
    month: "2026-10",
    spentUsd: "2.1",
    limitUsd: "40",
    paused: false,
    byRole: [],
    team: [],
    jobs: { open: 0, needsYou: 0 },
    ...(byDay === undefined ? {} : { byDay }),
  });
}

const DAYS = [
  {
    day: "2026-10-06",
    usd: "1.6",
    byRole: [
      { role: "WRITER", usd: "0.72" },
      { role: "RESEARCH", usd: "0.56" },
      { role: "REVIEWER", usd: "0.32" },
    ],
  },
  { day: "2026-10-12", usd: "0.5", byRole: [{ role: "WRITER", usd: "0.5" }] },
];
const OCT_20 = Date.parse("2026-10-20T12:00:00Z");

describe("cost day by day (option 3)", () => {
  it("lists every day so far; a day the ledger lists nothing for spent nothing", () => {
    const days = costDays(overview(DAYS), OCT_20);
    expect(days).toHaveLength(20);
    expect(days?.[5]).toEqual({
      day: 6,
      usd: 1.6,
      steps: [
        { name: "Writing", usd: 0.72 },
        { name: "Research", usd: 0.56 },
        { name: "Checking", usd: 0.32 },
      ],
    });
    expect(days?.[6]).toEqual({ day: 7, usd: 0, steps: [] });
  });

  it("keeps the days unknown when the server could not split them", () => {
    expect(costDays(overview(undefined), OCT_20)).toBeNull();
  });

  it("orders the month by job and folds the long tail", () => {
    const rows = costByJob(
      [1, 2, 3, 4, 5, 6].map((n) =>
        WorkforceJobDetailDtoSchema.parse({
          ...job({}),
          job: {
            ...job({}).job,
            id: id(40 + n),
            goal: `Job ${String(n)}`,
            costUsd: String(n),
          },
        }),
      ),
      null,
    );
    expect(rows.map((row) => row.name)).toEqual([
      "Job 6",
      "Job 5",
      "Job 4",
      "Job 3",
      "Smaller tasks (2)",
    ]);
    expect(rows[4]?.usd).toBe(3);
  });

  it("shows the busiest day first, a picked day's steps, and a quiet day as nothing", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_20);
    render(
      <WorkCostDays
        overview={overview(DAYS)}
        jobs={[]}
        work={null}
        now={OCT_20}
      />,
    );
    const info = document.querySelector("[data-cost-day-info]") as HTMLElement;
    expect(within(info).getByText("6 October")).toBeTruthy();
    expect(within(info).getByText("Writing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "8 October, $0.00" }));
    expect(within(info).getByText("Nothing spent this day.")).toBeTruthy();
    expect(screen.getByText("$2.10")).toBeTruthy();
    vi.useRealTimers();
  });

  it("says the days are unknown rather than drawing zeros", () => {
    render(
      <WorkCostDays
        overview={overview(undefined)}
        jobs={[]}
        work={null}
        now={OCT_20}
      />,
    );
    expect(document.querySelector("[data-cost-days-unknown]")).not.toBeNull();
    expect(document.querySelectorAll("[data-cost-day]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// What Q did: the audit trail
// ---------------------------------------------------------------------------

function delegation(kind: "INVESTOR_OUTREACH" | "STANDING_INSTRUCTION") {
  return QWorkDetailDtoSchema.parse({
    work: {
      id: id(50),
      kind,
      status: "ACTIVE",
      summary: "2 talking, 1 report ready",
      createdAt: "2026-10-16T15:12:00Z",
      expiresAt: "2026-11-16T15:12:00Z",
      goal: "Find seed-stage digital health companies in the UK with paying NHS customers.",
      run: { state: "WORKING", pauseReason: null },
      lanes: [
        {
          id: id(51),
          counterpartName: "Pellucid Health",
          stage: "REPORT_READY",
          lastStep: null,
          reasons: [
            { reason: "Paying NHS customers", quote: "Two NHS trusts pay us" },
          ],
          offered: [],
          report: null,
          chatPath: null,
          updatedAt: "2026-10-20T09:30:00Z",
        },
      ],
    },
    steps: [
      {
        words: "Q wrote the first-stage report on Pellucid Health: proceed.",
        at: "2026-10-20T09:30:00Z",
        by: "Q",
        laneId: id(51),
      },
      {
        words: "Pellucid Health accepted; Q sent your opening message.",
        at: "2026-10-18T14:22:00Z",
        by: "THEM",
        laneId: id(51),
      },
    ],
  });
}

describe("What Q did, the audit trail (option 1)", () => {
  it("says on whose authority each step was taken, and labels their words as claims", () => {
    render(
      <DelegationAudit
        detail={delegation("INVESTOR_OUTREACH")}
        side="INVESTOR"
      />,
    );
    const steps = document.querySelector(
      "[data-delegation-steps]",
    ) as HTMLElement;
    expect(within(steps).getByText("Q, under your instruction")).toBeTruthy();
    expect(within(steps).getByText("Their reply")).toBeTruthy();
    // The work started on the person's own yes.
    expect(within(steps).getByText("Your approval")).toBeTruthy();
    expect(screen.getByText("Founder’s claim")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Read the report" })
        .getAttribute("href"),
    ).toBe(`/work/${id(50)}/report/${id(51)}`);
    // Outreach has no pause of its own; stop asks once.
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("stops only after the person confirms, then says so", async () => {
    stop.mockResolvedValue({ ok: true, value: null });
    render(
      <DelegationAudit
        detail={delegation("INVESTOR_OUTREACH")}
        side="INVESTOR"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(
      document.querySelector("[data-delegation-confirm-stop]") as HTMLElement,
    );
    await settle();
    expect(stop).toHaveBeenCalledWith(id(50), null);
    expect(
      document
        .querySelector("[data-delegation-state]")
        ?.getAttribute("data-delegation-state"),
    ).toBe("STOPPED");
  });

  it("pauses a standing instruction", async () => {
    paused.mockResolvedValue({ ok: true, value: null });
    render(
      <DelegationAudit
        detail={delegation("STANDING_INSTRUCTION")}
        side="COMPANY"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await settle();
    expect(paused).toHaveBeenCalledWith(id(50), true);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    // A founder's picks are investors: their words are their stated mandate.
    expect(screen.getByText("Their stated mandate")).toBeTruthy();
  });
});
