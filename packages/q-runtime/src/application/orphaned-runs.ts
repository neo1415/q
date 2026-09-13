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
 * CANCEL_REQUESTED and stays there for the same reason.
 *
 * At startup, every non-terminal run is therefore closed honestly: a
 * pending cancellation is finished, and everything else fails as
 * RUN_EXPIRED, whose public projection is retryable and says the request
 * expired before it could finish. The terminal event is durable, so a
 * client that reconnects with Last-Event-ID receives it and shows exactly
 * one failure.
 *
 * This assumes a single orchestrating process, which is how q-api is
 * deployed (one Render service). A second instance would need to fence runs
 * by owner before sweeping; that is deliberately not modelled here.
 */

export type OrphanedRunSweepDependencies = {
  readonly sql: DatabaseExecutor;
  readonly runs: QRunRepository;
  readonly runtime: QOrchestrationRuntime;
  readonly logger?: Logger | undefined;
};

export type OrphanedRunSweepResult = {
  readonly examined: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly untouched: number;
};

const SWEEP_LIMIT = 500;

export function createOrphanedRunSweep(
  dependencies: OrphanedRunSweepDependencies,
): { readonly sweep: () => Promise<OrphanedRunSweepResult> } {
  const { sql, runs, runtime, logger } = dependencies;
  return {
    sweep: async (): Promise<OrphanedRunSweepResult> => {
      const orphaned = await runs.listNonTerminal(sql, SWEEP_LIMIT);
      let failed = 0;
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
        { examined: orphaned.length, failed, cancelled, untouched },
        "orphaned q runs swept",
      );
      return { examined: orphaned.length, failed, cancelled, untouched };
    },
  };
}
