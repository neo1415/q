import { describe, expect, it } from "vitest";

import type { WorkforceJobSummaryDto } from "@capital-q/contracts";

import {
  finishedSince,
  jobLine,
  jobsInProgress,
} from "../src/features/work/job-state";

/**
 * Recovery D6: the Work page shows a job's real, persisted state -- the
 * durable work row's `workState` and `stoppedBecause` -- not a guess, and
 * offers "Stop" only where stopping applies.
 */

const NOW = Date.parse("2026-10-08T18:00:00Z");

function job(extra: Partial<WorkforceJobSummaryDto>): {
  readonly job: WorkforceJobSummaryDto;
} {
  return {
    job: {
      id: "00000000-0000-4000-8000-000000000001",
      goal: "Research five investors",
      source: "JOB",
      status: "RUNNING",
      reviewBar: { threshold: 75, maxRedrafts: 1, rubricVersion: "r/v1" },
      budgetUsd: "0.5",
      costUsd: "0",
      agents: 2,
      drafts: 0,
      held: 0,
      createdAt: "2026-10-08T17:00:00.000Z",
      updatedAt: "2026-10-08T17:30:00.000Z",
      ...extra,
    },
  };
}

describe("a job's state on Work (D6)", () => {
  it("running work can be stopped; nothing else can", () => {
    expect(jobLine(job({ workState: "RUNNING" }).job)).toMatchObject({
      state: "Working",
      stoppable: true,
    });
    expect(jobLine(job({ workState: "RECOVERING" }).job).stoppable).toBe(true);
    expect(jobLine(job({ workState: "COMPLETED" }).job).stoppable).toBe(false);
    expect(jobLine(job({ workState: "CANCELLED" }).job)).toMatchObject({
      state: "Stopped by you",
      stoppable: false,
      stopped: true,
    });
  });

  it("a failed job says why, in the server's words (the 'why did it stop' field)", () => {
    const failed = job({
      status: "FAILED",
      workState: "FAILED",
      stoppedBecause:
        "This job stopped after 3 tries; nothing more will be tried.",
    });
    expect(jobLine(failed.job)).toMatchObject({
      state: "Failed",
      why: "This job stopped after 3 tries; nothing more will be tried.",
    });
    // And it stays on In progress this week, so it can be opened.
    expect(jobsInProgress([failed], NOW)).toHaveLength(1);
  });

  it("a finished job leaves In progress and shows under what Q finished", () => {
    const done = job({ status: "DONE", workState: "COMPLETED" });
    expect(jobsInProgress([done], NOW)).toEqual([]);
    expect(finishedSince([done], NOW - 86_400_000)).toEqual([done]);
    expect(finishedSince([done], NOW)).toEqual([]);
  });

  it("a job never queued falls back to its status, never stoppable", () => {
    expect(jobLine(job({ status: "HELD" }).job)).toMatchObject({
      state: "Waiting for you",
      stoppable: false,
    });
  });
});
