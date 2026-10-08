import type { QWorkState, WorkforceJobSummaryDto } from "@capital-q/contracts";

/**
 * Recovery D6: a job's state on the Work page, from the durable work row
 * (`workState`, `stoppedBecause`) -- the same fields Q reads when asked
 * "what are my agents doing", "open the task that failed" or "why did it
 * stop". A job that was never queued (older ones) falls back to its status.
 */

export type JobLine = {
  /** Plain words, never an internal state name. */
  readonly state: string;
  /** Why it stopped or waits, in the server's own words; null: running or done. */
  readonly why: string | null;
  /** Whether "Stop this job" applies: it is queued or running. */
  readonly stoppable: boolean;
  /** Whether it ended without finishing (failed, blocked, stopped). */
  readonly stopped: boolean;
  readonly finished: boolean;
};

const WORDS: Readonly<Record<QWorkState, string>> = {
  PLANNED: "Planned",
  AWAITING_AUTHORIZATION: "Waiting for your approval",
  QUEUED: "Queued",
  RUNNING: "Working",
  RECOVERING: "Picking up again",
  NEEDS_DECISION: "Waiting for you",
  BLOCKED: "Stopped: it needs you",
  FAILED: "Failed",
  CANCELLED: "Stopped by you",
  COMPLETED: "Done",
};

export function jobLine(job: WorkforceJobSummaryDto): JobLine {
  const state = job.workState;
  if (state === undefined) {
    return {
      state:
        job.status === "HELD"
          ? "Waiting for you"
          : job.status === "PLANNING"
            ? "Planning"
            : job.status === "DONE"
              ? "Done"
              : job.status === "FAILED"
                ? "Failed"
                : job.status === "STOPPED"
                  ? "Stopped"
                  : "Working",
      why: null,
      stoppable: false,
      stopped: job.status === "FAILED" || job.status === "STOPPED",
      finished: job.status === "DONE",
    };
  }
  return {
    state: WORDS[state],
    why: job.stoppedBecause ?? null,
    stoppable:
      state === "QUEUED" || state === "RUNNING" || state === "RECOVERING",
    stopped: state === "FAILED" || state === "BLOCKED" || state === "CANCELLED",
    finished: state === "COMPLETED",
  };
}

/** Jobs on the In progress list: running, waiting, or stopped this week. */
export function jobsInProgress<
  T extends { readonly job: WorkforceJobSummaryDto },
>(jobs: readonly T[], now: number): readonly T[] {
  const WEEK_MS = 7 * 86_400_000;
  return jobs.filter((one) => {
    if (one.job.source !== "JOB") return false;
    const line = jobLine(one.job);
    if (line.finished) return false;
    if (line.stopped) {
      return now - Date.parse(one.job.updatedAt) < WEEK_MS;
    }
    return (
      one.job.status === "RUNNING" ||
      one.job.status === "PLANNING" ||
      one.job.status === "HELD"
    );
  });
}

/** What Q finished since the person last looked (jobs; steps come from Done). */
export function finishedSince<
  T extends { readonly job: WorkforceJobSummaryDto },
>(jobs: readonly T[], since: number): readonly T[] {
  return jobs.filter(
    (one) =>
      one.job.source === "JOB" &&
      jobLine(one.job).finished &&
      Date.parse(one.job.updatedAt) >= since,
  );
}
