import { describe, expect, it } from "vitest";

import { qPartDone, verifiedDone } from "../src/composition/workforce/plans.js";
import type { StepRuntime } from "../src/composition/workforce/plan-thread.js";

// Live 2026-10-29: a step shared with the founder showed Done as soon as
// Q's research finished, while the founder's own part was still open on
// their board.
const runtime = (over: Partial<StepRuntime>): StepRuntime => ({
  status: "DOING",
  boardItemId: null,
  jobId: null,
  reminderId: null,
  actionId: null,
  ...over,
});
const state = (board: string, job: string) => ({
  board: new Map([["board-1", board]]),
  jobs: new Map([["job-1", job]]),
  actions: new Map<string, string>(),
});

describe("a shared step is done when their part is", () => {
  const shared = runtime({ boardItemId: "board-1", jobId: "job-1" });

  it("is not done while their board item is open, though Q's part finished", () => {
    const facts = state("TODO", "COMPLETED");
    expect(verifiedDone(shared, facts, "TOGETHER")).toBeNull();
    expect(qPartDone(shared, facts)).toBe("Q's work on it finished.");
  });

  it("is done once they mark their part done on the board", () => {
    expect(verifiedDone(shared, state("DONE", "RUNNING"), "TOGETHER")).toBe(
      "You marked it done on your board.",
    );
  });

  it("with no board item placed, Q's finished work completes it", () => {
    expect(
      verifiedDone(
        runtime({ jobId: "job-1" }),
        state("TODO", "COMPLETED"),
        "TOGETHER",
      ),
    ).toBe("Q's work on it finished.");
  });

  it("leaves Q's own steps done when their work finishes", () => {
    expect(verifiedDone(shared, state("TODO", "COMPLETED"), "Q")).toBe(
      "Q's work on it finished.",
    );
  });
});
