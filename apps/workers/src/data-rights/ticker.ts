import type { DataRightsJobs } from "@capital-q/data-rights";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Decision 107: builds queued data downloads, deletes expired ones and
 * runs account deletions whose grace period has passed. Downloads are
 * checked every minute (the person is waiting); each pass is bounded and
 * every job claims its row, so any number of workers can run this.
 */
export const DATA_RIGHTS_INTERVAL_MS = 60_000;
/** Downloads built per pass before the pass yields. */
const EXPORTS_PER_PASS = 3;

export async function runDataRightsTicker(options: {
  readonly jobs: DataRightsJobs;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  while (!options.signal.aborted) {
    try {
      for (let built = 0; built < EXPORTS_PER_PASS; built += 1) {
        if (!(await options.jobs.buildNextExport())) break;
      }
      await options.jobs.expireExports();
      await options.jobs.runDueDeletions();
    } catch {
      options.logger.warn(
        {},
        "data rights pass failed; retrying next interval",
      );
    }
    await sleep(options.intervalMs ?? DATA_RIGHTS_INTERVAL_MS, options.signal);
  }
}
