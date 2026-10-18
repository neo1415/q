// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Q_WORK_STATES } from "@capital-q/contracts";

import { workforceFixtures } from "../app/dev/workforce/fixtures";

/**
 * G-R5: the honest states are in the DOM for G's browser tests. Each job
 * card carries `data-work-state` (a QWorkState), each plan step its
 * `data-work-role`, and each draft `data-work-draft`.
 */

vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: () => Promise.resolve(null),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const { WorkforcePanel } = await import("../src/features/work/workforce-panel");
const { workStateOf } = await import("../src/features/work/job-state");
const { jobLines } = await import("../src/features/work/workforce-view");

afterEach(() => {
  cleanup();
});

const NOW = Date.parse("2026-10-06T21:10:00Z");

describe("work state attributes (G-R5)", () => {
  it("every job card carries a QWorkState and every plan step its role", () => {
    const { jobs, overview } = workforceFixtures(NOW);
    const { container } = render(
      <WorkforcePanel overview={overview} jobs={jobs} />,
    );
    const cards = [...container.querySelectorAll("[data-job]")];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const state = card.getAttribute("data-work-state");
      expect(Q_WORK_STATES as readonly (string | null)[]).toContain(state);
    }
    const steps = [...container.querySelectorAll("[data-step]")];
    expect(steps.length).toBeGreaterThan(0);
    expect(
      steps.every((step) => (step.getAttribute("data-work-role") ?? "") !== ""),
    ).toBe(true);
  });

  it("the durable work state wins; a job never queued maps its status honestly", () => {
    const { jobs } = workforceFixtures(NOW);
    const job = jobs[0]?.job;
    if (job === undefined) throw new Error("fixture");
    expect(workStateOf({ ...job, workState: "RECOVERING" })).toBe("RECOVERING");
    expect(workStateOf({ ...job, workState: undefined, status: "HELD" })).toBe(
      "NEEDS_DECISION",
    );
    expect(
      workStateOf({ ...job, workState: undefined, status: "STOPPED" }),
    ).toBe("CANCELLED");
  });

  it("each draft line names its draft (data-work-draft) and who acted on it", () => {
    const { jobs } = workforceFixtures(NOW);
    const drafts = jobs.flatMap((one) =>
      jobLines(one).flatMap((line) =>
        line.kind === "step" && line.draftId !== undefined ? [line] : [],
      ),
    );
    expect(drafts.length).toBeGreaterThan(0);
    const ids = new Set(jobs.flatMap((one) => one.drafts.map((d) => d.id)));
    for (const line of drafts) {
      expect(ids.has(line.draftId ?? "")).toBe(true);
      // The writer wrote it, the reviewer graded it, the person decided.
      const role = {
        draft: "WRITER",
        grade: "REVIEWER",
        sent: "LEAD",
      }[line.key.split(":")[0] ?? ""];
      if (role !== undefined) expect(line.role).toBe(role);
      else expect(["PERSON", "COUNTERPART"]).toContain(line.role);
    }
  });
});
