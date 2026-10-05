// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_IDS, workforceFixtures } from "../app/dev/workforce/fixtures";
import {
  costRows,
  jobLines,
  markAgainst,
  teamMembers,
} from "../src/features/work/workforce-view";

const approve = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: (id: string) => approve(id),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { WorkforcePanel } = await import("../src/features/work/workforce-panel");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NOW = Date.parse("2026-10-06T21:10:00Z");

describe("the workforce run log (J5)", () => {
  const { jobs, overview } = workforceFixtures(NOW);
  const intro = jobs[0];
  if (intro === undefined) throw new Error("fixture");

  it("reads a job as steps owned by specialists, in plain words", () => {
    const lines = jobLines(intro);
    const steps = lines.flatMap((line) =>
      line.kind === "step" ? [`${line.who}: ${line.title}`] : [line.text],
    );
    expect(steps).toEqual([
      "Lead Q: Planned the job",
      "Research: Read Kestrel’s deck and install log",
      "Handed to Writer",
      "Writer: Wrote draft 1",
      "Reviewer: Draft 1 below the bar",
      "Writer: Wrote draft 2",
      "Reviewer: Draft 2 passed",
      "Scheduler: Offer three times when they reply",
      "You: Approve and send",
    ]);
    // Never an internal role id or plan key.
    expect(steps.join(" ")).not.toMatch(
      /MANDATE_WATCHER|AD_HOC|REVIEWER|WRITER/u,
    );
  });

  it("shows the reviewer's score against the bar, and sends draft 1 back", () => {
    const lines = jobLines(intro);
    const back = lines.find(
      (line) => line.kind === "step" && line.title === "Draft 1 below the bar",
    );
    const passed = lines.find(
      (line) => line.kind === "step" && line.title === "Draft 2 passed",
    );
    expect(back).toMatchObject({
      state: "back",
      grade: { score: "6.2", bar: "8.0" },
    });
    expect(back?.kind === "step" && back.feedback).toMatch(
      /Sent back to Writer/u,
    );
    expect(passed).toMatchObject({
      state: "done",
      grade: { score: "8.7", bar: null },
    });
  });

  it("ties the approval to the exact draft's card", () => {
    const you = jobLines(intro).find(
      (line) => line.kind === "step" && line.approval !== undefined,
    );
    expect(you).toMatchObject({
      approval: {
        approvalId: FIXTURE_IDS.approval,
        draftId: FIXTURE_IDS.draft2,
      },
    });
  });

  it("marks what the redraft cut and added, word by word", () => {
    const [d1, d2] = intro.drafts;
    if (d1 === undefined || d2 === undefined) throw new Error("fixture");
    const cut = markAgainst(d1.body, d2.body, "cut").filter(
      (p) => p.mark === "cut",
    );
    expect(cut.map((p) => p.text.trim()).join(" ")).toContain(
      "Could we get 30 minutes this week?",
    );
    const kept = markAgainst(d2.body, d1.body, "add").filter(
      (p) => p.mark === null,
    );
    expect(kept.map((p) => p.text).join("")).toContain(
      "climate investing at Harbour",
    );
  });

  it("prices each specialist this month, the rest together", () => {
    const rows = costRows(overview);
    expect(rows.map((row) => row.name)).toEqual([
      "Research",
      "Writer",
      "Reviewer",
      "Conversation",
      "Mandate watcher",
      "Others",
    ]);
    expect(rows[0]?.share).toBe(100);
    expect(rows.at(-1)?.usd).toBe("2.700000");
  });

  it("lists who is on what, with counts written by code", () => {
    const team = teamMembers(overview);
    expect(team[0]).toMatchObject({
      name: "Lead Q",
      line: "Planning 4 jobs for you",
      state: "on",
    });
    expect(team.find((m) => m.role === "REVIEWER")?.line).toBe(
      "6 drafts today, 2 sent back",
    );
    expect(team.find((m) => m.role === "OUTREACH")?.label).toBe("Needs you");
  });
});

describe("the workforce panel", () => {
  it("renders the jobs, the team and the month against the limit", () => {
    const { jobs, overview } = workforceFixtures(NOW);
    render(<WorkforcePanel overview={overview} jobs={jobs} />);
    expect(screen.getByRole("heading", { name: "Q’s team" })).toBeTruthy();
    expect(screen.getByText("4 jobs. 1 needs you.")).toBeTruthy();
    expect(screen.getByText("Intro to Kestrel Heat")).toBeTruthy();
    expect(screen.getByText("Who’s on it")).toBeTruthy();
    expect(screen.getByText("$41.80 of $60")).toBeTruthy();
    expect(
      screen.getByText("Q pauses new work and asks you at $60."),
    ).toBeTruthy();
  });

  it("approves through the Approval Engine with the draft's own card", async () => {
    approve.mockResolvedValue({ ok: true, value: null });
    const { jobs, overview } = workforceFixtures(NOW);
    render(<WorkforcePanel overview={overview} jobs={jobs} />);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Approve and send",
      })[0] as HTMLElement,
    );
    await vi.waitFor(() => {
      expect(approve).toHaveBeenCalledWith(FIXTURE_IDS.approval);
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("opens both drafts with their grades, bound to the exact text", () => {
    const { jobs, overview } = workforceFixtures(NOW);
    render(
      <WorkforcePanel
        overview={overview}
        jobs={jobs}
        openDraftId={FIXTURE_IDS.draft2}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Draft 1")).toBeTruthy();
    expect(within(dialog).getByText("Draft 2")).toBeTruthy();
    expect(
      within(dialog).getByText(/You approve this exact text/u),
    ).toBeTruthy();
  });

  it("says when it could not load, and when there is nothing yet", () => {
    const { overview } = workforceFixtures(NOW);
    const { unmount } = render(<WorkforcePanel overview={null} jobs={null} />);
    expect(screen.getByText(/couldn’t load/u)).toBeTruthy();
    unmount();
    render(
      <WorkforcePanel
        overview={{
          ...overview,
          byRole: [],
          spentUsd: "0",
          jobs: { open: 0, needsYou: 0 },
        }}
        jobs={[]}
      />,
    );
    expect(screen.getByText(/No jobs yet/u)).toBeTruthy();
    expect(screen.getByText("Nothing spent yet this month.")).toBeTruthy();
  });

  it("switches between Now, Team and Cost on a phone", () => {
    const { jobs, overview } = workforceFixtures(NOW);
    render(<WorkforcePanel overview={overview} jobs={jobs} />);
    const team = screen.getByRole("tab", { name: "Team" });
    fireEvent.click(team);
    expect(team.getAttribute("aria-selected")).toBe("true");
  });

  it("shows a paused month plainly", () => {
    const { jobs, overview } = workforceFixtures(NOW);
    render(
      <WorkforcePanel
        overview={{ ...overview, spentUsd: "60", paused: true }}
        jobs={jobs}
      />,
    );
    expect(screen.getByText(/The limit is reached/u)).toBeTruthy();
  });
});
