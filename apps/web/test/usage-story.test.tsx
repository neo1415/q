// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { QUsageDto, QWorkDto } from "@capital-q/contracts";

import { UsageStory, workInMonth } from "../src/features/billing/usage-story";

afterEach(cleanup);

const usage: QUsageDto = {
  month: "2026-10",
  totalUsd: "0.810000",
  calls: 1389,
  unpricedCalls: 2,
  failedCalls: 385,
  byTask: [
    { purpose: "CONVERSATION", usd: "0.390000", calls: 40 },
    { purpose: "REHEARSAL", usd: "0.080000", calls: 9 },
    { purpose: "OTHER", usd: "0", calls: 3 },
  ],
  instructions: [],
  plan: {
    name: "Launch",
    features: [
      {
        key: "q.research",
        name: "Research",
        description: "",
        kind: "MONTHLY",
        unitSingular: "search",
        unitPlural: "searches",
        included: true,
        limit: 100,
        used: 38,
        resetsAt: "2026-11-01T00:00:00.000Z",
        overridden: false,
      },
      {
        key: "q.rehearsals",
        name: "Pitch rehearsals",
        description: "",
        kind: "MONTHLY",
        unitSingular: "rehearsal",
        unitPlural: "rehearsals",
        included: false,
        limit: null,
        used: null,
        resetsAt: null,
        overridden: false,
      },
    ],
  },
};

const running = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "STANDING_INSTRUCTION",
  status: "ACTIVE",
  summary: null,
  createdAt: "2026-10-02T09:00:00.000Z",
  expiresAt: "2026-12-02T09:00:00.000Z",
  lanes: [],
  goal: "Follow replies from founders",
  run: null,
  lastStep: null,
  spend: null,
  delegation: null,
} as QWorkDto;

describe("Settings → Usage, what Q did in words (chosen design 2026-10-21)", () => {
  it("tells the work first: standing work says it is running, then each kind of work's cost", () => {
    render(
      <UsageStory
        usage={usage}
        work={[running]}
        period="current"
        planName="Launch"
      />,
    );
    expect(screen.getByText("Follow replies from founders")).toBeTruthy();
    expect(screen.getByText("Standing instruction, running")).toBeTruthy();
    expect(screen.getByText("Since 2 Oct")).toBeTruthy();
    expect(screen.getByText("Talked things through with you")).toBeTruthy();
    expect(screen.getByText("Conversations with Q, about $0.39")).toBeTruthy();
    // A purpose with nothing spent is not a line.
    expect(screen.queryByText("Other work for you")).toBeNull();
    expect(screen.getByText("Launch. Resets on the 1st.")).toBeTruthy();
  });

  it("puts the plan's own counts underneath, and an excluded feature says so, not zero", () => {
    render(
      <UsageStory usage={usage} work={[]} period="current" planName="Launch" />,
    );
    expect(screen.getByText("Totals this month")).toBeTruthy();
    expect(screen.getByText("of 100")).toBeTruthy();
    expect(screen.getByText("62 left, resets 1 Nov")).toBeTruthy();
    expect(screen.getByText("Not included in your plan")).toBeTruthy();
  });

  it("never shows call counts or failed calls", () => {
    render(
      <UsageStory usage={usage} work={null} period="current" planName={null} />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/failed|model call|1389|385/u);
  });

  it("last month: an honest empty state when nothing was done", () => {
    render(
      <UsageStory
        usage={{ ...usage, month: "2026-09", byTask: [], plan: null }}
        work={[]}
        period="previous"
        planName={null}
      />,
    );
    expect(screen.getByText("Nothing recorded last month")).toBeTruthy();
    expect(
      screen.getByText("Nothing used, so there are no totals."),
    ).toBeTruthy();
    const current = document.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe("Last month");
  });

  it("places a job in the months it ran", () => {
    expect(workInMonth(running, "2026-10")).toBe(true);
    expect(workInMonth(running, "2026-09")).toBe(false);
    const done = {
      ...running,
      status: "DONE",
      lastStep: {
        words: "Done",
        at: "2026-10-03T00:00:00.000Z",
        doneForYou: false,
        undo: null,
      },
      createdAt: "2026-09-20T00:00:00.000Z",
    } as QWorkDto;
    expect(workInMonth(done, "2026-09")).toBe(true);
    expect(workInMonth(done, "2026-11")).toBe(false);
  });
});
