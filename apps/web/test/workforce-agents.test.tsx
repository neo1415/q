// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  QWorkDtoSchema,
  WorkforceJobDetailDtoSchema,
  WorkforceOverviewDtoSchema,
  type WorkforceJobDetailDto,
  type WorkforceOverviewDto,
} from "@capital-q/contracts";

import { workforceFixtures } from "../app/dev/workforce/fixtures";
import {
  agentNodes,
  clampZoom,
  fitView,
  mapLinks,
  pauseOf,
  stateCounts,
  stateLabel,
  zoomAbout,
  zoomLevel,
  type AgentNode,
} from "../src/features/work/workforce-agents";
import {
  freshness,
  nextDelay,
  useLive,
} from "../src/features/work/workforce-live";

vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: () => Promise.resolve({ ok: true }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { WorkforceTeam } = await import("../src/features/work/workforce-map");

beforeAll(() => {
  // jsdom has no ResizeObserver; the map only needs it to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = Date.parse("2026-10-06T21:10:00Z");
const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BAR = { threshold: 75, maxRedrafts: 2, rubricVersion: "rubric/v1" };

function job(
  n: number,
  status: string,
  agents: readonly {
    role: string;
    status: string;
    goal?: string;
    summary?: string | null;
    minutesAgo?: number;
  }[],
  drafts: readonly Record<string, unknown>[] = [],
): WorkforceJobDetailDto {
  return WorkforceJobDetailDtoSchema.parse({
    job: {
      id: uid(n * 100),
      goal: `Job ${String(n)}`,
      source: "JOB",
      status,
      reviewBar: BAR,
      budgetUsd: "1",
      costUsd: "0.2",
      agents: agents.length,
      drafts: drafts.length,
      held: 0,
      createdAt: at(30),
      updatedAt: at(1),
    },
    agents: agents.map((one, index) => ({
      id: uid(n * 100 + index + 1),
      role: one.role,
      agentName: one.role,
      goal: one.goal ?? `${one.role} step`,
      tools: [],
      status: one.status,
      summary: one.summary ?? null,
      spawnedByRunId: null,
      spawned: false,
      budgetUsd: "0.1",
      costUsd: "0.01",
      startedAt: at(one.minutesAgo ?? 5),
      endedAt: one.status === "RUNNING" ? null : at(one.minutesAgo ?? 5),
    })),
    drafts,
    timeline: [],
  });
}

function draft(
  n: number,
  outcome: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id: uid(n),
    attempt: 1,
    parentDraftId: null,
    channel: "CHAT",
    counterpartName: "Nadia Okafor",
    body: "Hi Nadia",
    grade: null,
    outcome,
    feedback: [],
    createdAt: at(3),
    ...extra,
  };
}

function overview(
  // Parsed below: raw fixtures (status strings) are validated, not cast.
  extra: Readonly<Record<string, unknown>> = {},
): WorkforceOverviewDto {
  return WorkforceOverviewDtoSchema.parse({
    month: "2026-10",
    spentUsd: "4.2",
    limitUsd: "25",
    paused: false,
    byRole: [{ role: "WRITER", usd: "1.5" }],
    team: [],
    jobs: { open: 1, needsYou: 0 },
    ...extra,
  });
}

const byRole = (nodes: readonly AgentNode[]) =>
  new Map(nodes.map((node) => [node.role, node]));

describe("agent states from what the server recorded (P7)", () => {
  it("reads the design fixtures: the lead asks, the live steps work, the rest are idle", () => {
    const { overview: ov, jobs } = workforceFixtures(NOW);
    const nodes = byRole(agentNodes({ overview: ov, jobs, now: NOW }));
    expect(nodes.get("LEAD")?.state).toBe("asking");
    expect(nodes.get("LEAD")?.approval).not.toBeNull();
    expect(nodes.get("CONVERSATION")?.state).toBe("working");
    expect(nodes.get("MANDATE_WATCHER")?.state).toBe("working");
    expect(nodes.get("RESEARCH")?.state).toBe("done");
    expect(nodes.get("SCHEDULER")?.state).toBe("idle");
    // Every roster member, the lead first; never an internal id in the words.
    const list = agentNodes({ overview: ov, jobs, now: NOW });
    expect(list[0]?.role).toBe("LEAD");
    expect(
      list.map((node) => `${node.name} ${node.now}`).join(" "),
    ).not.toMatch(/MANDATE_WATCHER|AD_HOC|[0-9a-f]{8}-[0-9a-f]{4}/u);
  });

  it("covers every state: asking, held, failed, working, thinking, waiting, paused, done, idle", () => {
    const jobs = [
      job(
        1,
        "RUNNING",
        [{ role: "OUTREACH", status: "DONE" }],
        [
          draft(11, {
            outcome: "OFFERED",
            reason: null,
            qActionId: uid(12),
            approvalId: uid(13),
            approvalStatus: "PENDING",
          }),
        ],
      ),
      job(
        2,
        "RUNNING",
        [{ role: "WRITER", status: "DONE" }],
        [draft(21, { outcome: "HELD", reason: "BELOW_BAR", qActionId: null })],
      ),
      job(3, "RUNNING", [
        {
          role: "DOCUMENTS",
          status: "FAILED",
          summary: "The deck is password protected.",
        },
        {
          role: "MANDATE_WATCHER",
          status: "RUNNING",
          goal: "Reading 14 new companies",
        },
        { role: "RESEARCH", status: "DONE", summary: "4 findings" },
      ]),
      job(4, "PLANNING", []),
      job(
        5,
        "RUNNING",
        [{ role: "CONVERSATION", status: "DONE" }],
        [
          draft(
            51,
            { outcome: "SENT", reason: null, qActionId: null },
            { counterpartName: "Tom Reyes" },
          ),
        ],
      ),
    ];
    const work = [
      QWorkDtoSchema.parse({
        id: uid(900),
        kind: "STANDING_INSTRUCTION",
        status: "ACTIVE",
        summary: null,
        createdAt: at(60),
        expiresAt: at(-6000),
        lanes: [],
        goal: "Book calls",
        run: { state: "PAUSED", pauseReason: "OUTSIDE_HOURS" },
      }),
    ];
    const nodes = byRole(
      agentNodes({ overview: overview(), jobs, work, now: NOW }),
    );
    expect(nodes.get("OUTREACH")?.state).toBe("asking");
    expect(nodes.get("OUTREACH")?.now).toContain("Nadia Okafor");
    expect(nodes.get("REVIEWER")?.state).toBe("held");
    expect(nodes.get("REVIEWER")?.now).toMatch(
      /didn't reach your bar|didn’t reach your bar/u,
    );
    expect(nodes.get("DOCUMENTS")?.state).toBe("failed");
    expect(nodes.get("DOCUMENTS")?.now).toBe("The deck is password protected.");
    expect(nodes.get("MANDATE_WATCHER")?.state).toBe("working");
    // The lead plans job 4; planning outranks the instruction's pause.
    expect(nodes.get("LEAD")?.state).toBe("thinking");
    expect(nodes.get("CONVERSATION")?.state).toBe("waiting");
    expect(stateLabel(nodes.get("CONVERSATION") ?? ({} as AgentNode))).toBe(
      "Waiting on Tom",
    );
    expect(nodes.get("RESEARCH")?.state).toBe("done");
    expect(nodes.get("SCHEDULER")?.state).toBe("idle");

    const paused = byRole(
      agentNodes({ overview: overview(), jobs: [], work, now: NOW }),
    );
    expect(paused.get("LEAD")?.state).toBe("paused");
    expect(paused.get("LEAD")?.pause).toBe("hours");
    expect(stateLabel(paused.get("LEAD") ?? ({} as AgentNode))).toBe(
      "Paused: outside hours",
    );
  });

  it("pauses live work at the month's limit, and asking still wins", () => {
    const jobs = [
      job(1, "RUNNING", [{ role: "WRITER", status: "RUNNING" }]),
      job(
        2,
        "RUNNING",
        [{ role: "OUTREACH", status: "RUNNING" }],
        [
          draft(21, {
            outcome: "OFFERED",
            reason: null,
            qActionId: null,
            approvalId: uid(22),
            approvalStatus: "PENDING",
          }),
        ],
      ),
    ];
    const nodes = byRole(
      agentNodes({ overview: overview({ paused: true }), jobs, now: NOW }),
    );
    expect(nodes.get("WRITER")?.state).toBe("paused");
    expect(nodes.get("WRITER")?.pause).toBe("budget");
    expect(nodes.get("OUTREACH")?.state).toBe("asking");
  });

  it("never calls an old result done: past a day it is idle again", () => {
    const jobs = [
      job(1, "DONE", [
        { role: "RESEARCH", status: "DONE", minutesAgo: 60 * 30 },
      ]),
    ];
    const nodes = byRole(agentNodes({ overview: overview(), jobs, now: NOW }));
    expect(nodes.get("RESEARCH")?.state).toBe("idle");
  });

  describe("standing instructions (Zino, 7 Oct: every agent read Idle)", () => {
    const step = (extra: Record<string, unknown>) => ({
      action: "chat.message.send",
      status: "ASKED",
      reasonCode: null,
      words: "Waiting for your yes: Introduce Ledgerline specifically",
      at: at(60),
      approvalId: null,
      approvalStatus: null,
      ...extra,
    });
    const instruction = (
      steps: readonly Record<string, unknown>[],
      extra: Record<string, unknown> = {},
    ) => ({
      id: uid(900),
      goal: "Express interest in companies that match my mandate",
      status: "ACTIVE",
      pauseReason: null,
      lastRunAt: at(60),
      nextRunAt: new Date(NOW + 3 * 60 * 60_000).toISOString(),
      steps,
      ...extra,
    });
    // The instruction's job: its lead run stays open between firings.
    const instructionJob = (
      drafts: readonly Record<string, unknown>[] = [],
    ) => {
      const one = job(
        5,
        "RUNNING",
        [
          { role: "LEAD", status: "RUNNING", minutesAgo: 60 * 26 },
          { role: "WRITER", status: "DONE", minutesAgo: 60 },
        ],
        drafts,
      );
      return { ...one, job: { ...one.job, source: "INSTRUCTION" as const } };
    };

    it("cards waiting on the person ask from the specialist that drafted them, with a count", () => {
      const ov = overview({
        team: [
          {
            role: "LEAD",
            state: "WORKING",
            runs: 1,
            drafts: 0,
            sentBack: 0,
            latest: null,
          },
        ],
        instructions: [
          instruction([
            step({ approvalId: uid(1), approvalStatus: "PENDING" }),
            step({ approvalId: uid(2), approvalStatus: "PENDING", at: at(61) }),
            step({ approvalId: uid(3), approvalStatus: "EXPIRED", at: at(62) }),
            step({
              action: "q.note",
              status: "NOTED",
              reasonCode: "QUESTION_FOR_YOU",
              words: "Passed Tensorgate's question to you",
            }),
            step({
              action: "relationship.interest.express",
              status: "DONE",
              words: "Expressed interest in Baridi",
            }),
          ]),
        ],
      });
      const nodes = byRole(
        agentNodes({ overview: ov, jobs: [instructionJob()], now: NOW }),
      );
      expect(nodes.get("OUTREACH")?.state).toBe("asking");
      expect(nodes.get("OUTREACH")?.now).toMatch(/^2 cards wait for your yes/u);
      expect(nodes.get("CONVERSATION")?.state).toBe("held");
      expect(nodes.get("MANDATE_WATCHER")?.state).toBe("done");
      // The open lead run is a schedule, not work: it says when it runs next.
      expect(nodes.get("LEAD")?.state).toBe("done");
      expect(nodes.get("LEAD")?.now).toMatch(/^Ran \d\d:\d\d\. Next run /u);
      expect(nodes.get("LEAD")?.nextRunAt).not.toBeNull();
      // No invented activity elsewhere.
      expect(nodes.get("SCHEDULER")?.state).toBe("idle");
    });

    it("a card the job already shows keeps its text and approval, under the drafting specialist", () => {
      const ov = overview({
        instructions: [
          instruction([
            step({ approvalId: uid(13), approvalStatus: "PENDING" }),
          ]),
        ],
      });
      const jobs = [
        instructionJob([
          draft(11, {
            outcome: "OFFERED",
            reason: null,
            qActionId: uid(12),
            approvalId: uid(13),
            approvalStatus: "PENDING",
          }),
        ]),
      ];
      const nodes = byRole(agentNodes({ overview: ov, jobs, now: NOW }));
      expect(nodes.get("OUTREACH")?.state).toBe("asking");
      expect(nodes.get("OUTREACH")?.approval?.approvalId).toBe(uid(13));
      expect(nodes.get("OUTREACH")?.now).not.toMatch(/cards wait/u);
      expect(nodes.get("LEAD")?.state).not.toBe("asking");
    });

    it("an expired card never asks, and a quiet instruction is idle with its next run", () => {
      const ov = overview({
        instructions: [
          instruction(
            [step({ approvalId: uid(1), approvalStatus: "EXPIRED" })],
            { lastRunAt: at(60 * 30) },
          ),
        ],
      });
      const nodes = byRole(agentNodes({ overview: ov, jobs: [], now: NOW }));
      expect(nodes.get("OUTREACH")?.state).toBe("idle");
      expect(nodes.get("LEAD")?.state).toBe("idle");
      expect(nodes.get("LEAD")?.now).toMatch(
        /^Nothing running\. Next run (?:[A-Z][a-z]{2} )?\d\d:\d\d\.$/u,
      );
    });

    it("an older server (no instructions) keeps the job-only reading", () => {
      const nodes = byRole(
        agentNodes({
          overview: overview(),
          jobs: [instructionJob()],
          now: NOW,
        }),
      );
      expect(nodes.get("LEAD")?.state).toBe("working");
    });
  });

  it("reads pause reasons in the person's words", () => {
    expect(pauseOf("BUDGET_EXHAUSTED")).toBe("budget");
    expect(pauseOf("OUTSIDE_HOURS")).toBe("hours");
    expect(pauseOf("PAUSED_BY_YOU")).toBe("you");
    expect(pauseOf(null)).toBe("you");
  });

  it("draws a live line only to work that is running, and a dotted one to a question", () => {
    const { overview: ov, jobs } = workforceFixtures(NOW);
    const links = mapLinks(agentNodes({ overview: ov, jobs, now: NOW }));
    expect(links.find((l) => l.to === "CONVERSATION")?.kind).toBe("live");
    expect(links.find((l) => l.to === "SCHEDULER")?.kind).toBe("plain");
    expect(links.some((l) => l.from === "WRITER" && l.to === "REVIEWER")).toBe(
      true,
    );
  });
});

describe("zoom", () => {
  it("clamps, keeps the point under the cursor still, fits and centres", () => {
    expect(clampZoom(10)).toBe(1.8);
    expect(clampZoom(0.01)).toBe(0.4);
    expect(clampZoom(Number.NaN)).toBe(1);
    const view = zoomAbout({ scale: 1, x: 0, y: 0 }, 1.5, 100, 50);
    // The world point under (100, 50) stays under it.
    expect((100 - view.x) / view.scale).toBeCloseTo(100);
    expect((50 - view.y) / view.scale).toBeCloseTo(50);
    const fit = fitView(
      { width: 1000, height: 600 },
      { width: 1240, height: 740 },
    );
    expect(fit.x).toBeCloseTo((1000 - 1240 * fit.scale) / 2);
    expect(zoomLevel(0.5)).toBe("far");
    expect(zoomLevel(1)).toBe("mid");
    expect(zoomLevel(1.5)).toBe("near");
  });
});

describe("live reads", () => {
  it("never reads while hidden or offline, backs off on failure, slows when idle", () => {
    const base = {
      hidden: false,
      offline: false,
      active: true,
      failures: 0,
      focused: true,
    };
    expect(nextDelay({ ...base, hidden: true })).toBeNull();
    expect(nextDelay({ ...base, offline: true })).toBeNull();
    expect(nextDelay(base)).toBe(8_000);
    expect(nextDelay({ ...base, active: false })).toBe(30_000);
    expect(nextDelay({ ...base, focused: false })).toBe(60_000);
    expect(
      [1, 2, 3, 4, 5, 9].map((failures) => nextDelay({ ...base, failures })),
    ).toEqual([10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
    expect(freshness(NOW - 3_000, NOW)).toBe("updated just now");
    expect(freshness(NOW - 40_000, NOW)).toBe("updated 40 s ago");
  });

  it("keeps the last good data when a read fails, and reads again later", async () => {
    vi.useFakeTimers();
    const load = vi.fn<() => Promise<{ n: number } | null>>();
    load.mockResolvedValueOnce(null).mockResolvedValueOnce({ n: 2 });
    const seen: { data: { n: number } | null; status: string }[] = [];
    function Probe() {
      const live = useLive({
        initial: { n: 1 },
        load,
        isActive: () => true,
        focused: true,
      });
      seen.push({ data: live.data, status: live.status });
      return null;
    }
    render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual({ data: { n: 1 }, status: "stale" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toEqual({ data: { n: 2 }, status: "live" });
  });
});

describe("the team map", () => {
  const { overview: ov, jobs } = workforceFixtures(NOW);
  const nodes = agentNodes({ overview: ov, jobs, now: NOW });

  it("filters by state, switches to the list, zooms and opens a specialist", () => {
    const onOpen = vi.fn();
    render(
      <WorkforceTeam
        nodes={nodes}
        now={NOW}
        onOpen={onOpen}
        approve={() => <button type="button">Approve</button>}
      />,
    );
    const counts = stateCounts(nodes);
    expect(
      screen.getAllByRole("button", { pressed: false }).length,
    ).toBeGreaterThanOrEqual(counts.length);

    // Zoom buttons change the scale shown.
    const zoom = screen.getByRole("group", { name: "Zoom" });
    const before = within(zoom).getByText(/%$/u).textContent;
    fireEvent.click(within(zoom).getByRole("button", { name: "Zoom in" }));
    expect(within(zoom).getByText(/%$/u).textContent).not.toBe(before);
    // Keyboard: 0 fits again.
    fireEvent.keyDown(screen.getByRole("application"), { key: "0" });
    expect(within(zoom).getByText(/%$/u).textContent).toBe(before);

    // A node opens its specialist.
    fireEvent.click(
      screen.getByRole("button", { name: /^Mandate watcher: Working/u }),
    );
    expect(onOpen).toHaveBeenCalledWith("MANDATE_WATCHER");

    // Far out the map shows rings and names only; closer, the asking
    // specialist carries its inline approve.
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(screen.getByRole("application"), { key: "+" });
    }
    const lead = document.querySelector('[data-agent="LEAD"]');
    expect(lead?.getAttribute("data-state")).toBe("asking");
    expect(
      within(lead as HTMLElement).getByRole("button", { name: "Approve" }),
    ).toBeTruthy();

    // Filter: only working specialists in the list twin.
    fireEvent.click(
      screen.getByRole("button", { name: /Working$/u, pressed: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const rows = document.querySelectorAll("[data-agent-row]");
    expect(
      [...rows].map((row) => row.getAttribute("data-agent-row")).sort(),
    ).toEqual(["CONVERSATION", "MANDATE_WATCHER"]);
  });
});
