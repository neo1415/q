import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type { QRunRepository } from "./ports.js";
import { runRef, type QOrchestrationRuntime } from "./orchestration-runtime.js";

/**
 * Orphaned runs (CQ-PRE-REC-001 §8: one failed run → one visible error).
 *
 * Orchestration lives in the Q API process. When that process stops with a
 * run in flight — a deploy, a crash, a developer rebuild — the run's row
 * keeps saying PLANNING or SYNTHESIS, nothing ever moves it again, and a
 * person who reconnects sees "working" forever; a Stop request lands as
 * CANCEL_REQUESTED and stays there for the same reason. Such a run is
 * closed honestly: a pending cancellation is finished, and everything else
 * fails as RUN_EXPIRED, whose public projection is retryable.
 *
 * Fenced by silence, not by "whatever is not terminal" (CQ-QACT-001). The
 * sweep used to close every non-terminal run in the database at startup,
 * which on a shared database — two local instances, or a rolling deploy
 * with old and new processes overlapping — killed another process's live
 * run seconds after it started. A run is orphaned here only when it has
 * shown no sign of life for longer than any live run goes quiet: a live
 * run writes a durable event at every stage, so one silent for the
 * in-flight window has no engine behind it anywhere. A run paused for a
 * person (approval, input) needs no engine at all — its checkpoint resumes
 * in any process — so it is left alone for much longer, and never closed
 * merely because a process restarted.
 *
 * Because young orphans are now left until they age out, the sweep also
 * runs periodically rather than only at startup.
 */

export type OrphanedRunSweepDependencies = {
  readonly sql: DatabaseExecutor;
  readonly runs: QRunRepository;
  readonly runtime: QOrchestrationRuntime;
  readonly logger?: Logger | undefined;
  /** Silence after which an in-flight run has no engine. Default 15 minutes. */
  readonly inFlightWindowMs?: number | undefined;
  /** Silence after which a paused run is abandoned. Default 24 hours. */
  readonly pausedWindowMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
};

export type OrphanedRunSweepResult = {
  readonly examined: number;
  readonly failed: number;
  /** Paused runs whose wait ran out: EXPIRED, not FAILED. */
  readonly expired: number;
  readonly cancelled: number;
  readonly untouched: number;
};

const SWEEP_LIMIT = 500;
export const ORPHAN_IN_FLIGHT_WINDOW_MS = 15 * 60 * 1000;
export const ORPHAN_PAUSED_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createOrphanedRunSweep(
  dependencies: OrphanedRunSweepDependencies,
): { readonly sweep: () => Promise<OrphanedRunSweepResult> } {
  const { sql, runs, runtime, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const inFlightWindow =
    dependencies.inFlightWindowMs ?? ORPHAN_IN_FLIGHT_WINDOW_MS;
  const pausedWindow = dependencies.pausedWindowMs ?? ORPHAN_PAUSED_WINDOW_MS;
  return {
    sweep: async (): Promise<OrphanedRunSweepResult> => {
      const at = now().getTime();
      const orphaned = await runs.listStale(sql, {
        inFlightSilentSince: new Date(at - inFlightWindow).toISOString(),
        pausedSilentSince: new Date(at - pausedWindow).toISOString(),
        limit: SWEEP_LIMIT,
      });
      let failed = 0;
      let expired = 0;
      let cancelled = 0;
      let untouched = 0;
      for (const run of orphaned) {
        try {
          if (run.status === "CANCEL_REQUESTED") {
            const outcome = await runtime.finishCancellation(runRef(run));
            if (outcome.kind === "ADVANCED") {
              cancelled += 1;
            } else {
              untouched += 1;
            }
            continue;
          }
          // A run that waited on a person (an approval card, a question)
          // did not fail: its wait ran out (autopilot P1, live 2026-10-06:
          // 24 standing-instruction cards a day were closed as FAILED
          // RUN_EXPIRED). It ends EXPIRED, with the approval's own reason.
          if (
            run.status === "AWAITING_APPROVAL" ||
            run.status === "AWAITING_INPUT"
          ) {
            const outcome = await runtime.expire(
              runRef(run),
              run.status === "AWAITING_APPROVAL"
                ? "APPROVAL_EXPIRED"
                : "RUN_EXPIRED",
            );
            if (outcome.kind === "ADVANCED") {
              expired += 1;
            } else {
              untouched += 1;
            }
            continue;
          }
          const outcome = await runtime.fail(runRef(run), "RUN_EXPIRED");
          if (outcome.kind === "ADVANCED") {
            failed += 1;
          } else {
            untouched += 1;
          }
        } catch (error: unknown) {
          // One run that cannot be closed must not stop the others from
          // being closed. Its row is unchanged and will be seen again.
          untouched += 1;
          logger?.warn(
            { err: error, qRunId: run.id, status: run.status },
            "orphaned q run could not be closed",
          );
        }
      }
      logger?.info(
        { examined: orphaned.length, failed, expired, cancelled, untouched },
        "orphaned q runs swept",
      );
      return {
        examined: orphaned.length,
        failed,
        expired,
        cancelled,
        untouched,
      };
    },
  };
}
