import type { QToolCallOutcome, QToolProposal } from "@capital-q/q-runtime";

/**
 * K4 (founder brief 2026-10-09): identical reads asked for at the same
 * time within one run share one call. The fit sweep, the catalog path and
 * the model's own tool round can ask `fit_profile` for the same company,
 * and the prepare reads overlap the answer's; each paid a full read. Only
 * a tool the run's offer declared READ_ONLY is shared, only while the
 * first call is in flight (never a cache: the next read is fresh), and
 * only within the same run and the same plan, so no result crosses a
 * person, a run or an authorisation.
 *
 * Lead 2026-10-16 (cache authorised reads within a run): a read that
 * succeeded is also kept for the rest of its run, so the model's own tool
 * round re-reading what the prepare, the fit sweep or a code path already
 * read (a company's profile, their relationships) answers at once. Kept
 * per run only, bounded, never across runs or people; any change-making
 * call in the run forgets it (a read after a write is read again), and
 * the run's end (takeShared) drops it.
 */

export type SingleFlight = {
  /** Runs `work`, or joins an identical read already in flight. */
  readonly execute: (
    runId: string,
    proposal: QToolProposal,
    readOnly: boolean,
    work: () => Promise<QToolCallOutcome>,
  ) => Promise<QToolCallOutcome>;
  /** How many reads this run shared, then forgets the run. */
  readonly takeShared: (runId: string) => number;
};

const RUNS_MAX = 256;
/** Completed reads kept per run, at most, for this many recent runs. */
const KEPT_PER_RUN = 64;
const KEPT_RUNS_MAX = 32;

/** Arguments as one key whatever order their properties came in. */
export function stableArguments(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableArguments).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, inner]) => `${JSON.stringify(key)}:${stableArguments(inner)}`)
    .join(",")}}`;
}

export function createSingleFlight(): SingleFlight {
  const inFlight = new Map<string, Promise<QToolCallOutcome>>();
  const shared = new Map<string, number>();
  const kept = new Map<string, Map<string, QToolCallOutcome>>();
  const count = (runId: string): void => {
    shared.set(runId, (shared.get(runId) ?? 0) + 1);
  };
  return {
    execute: (runId, proposal, readOnly, work) => {
      if (!readOnly) {
        // A change in this run: what was read before it is read again.
        kept.delete(runId);
        return work();
      }
      const key = `${runId}\u0000${proposal.name}\u0000${stableArguments(proposal.arguments)}`;
      const done = kept.get(runId)?.get(key);
      if (done !== undefined) {
        count(runId);
        return Promise.resolve({ ...done, callId: proposal.callId });
      }
      const running = inFlight.get(key);
      if (running !== undefined) {
        count(runId);
        if (shared.size > RUNS_MAX) {
          const oldest = shared.keys().next().value;
          if (oldest !== undefined) shared.delete(oldest);
        }
        // The caller's own call id: the outcome is its answer too.
        return running.then((outcome) => ({
          ...outcome,
          callId: proposal.callId,
        }));
      }
      const started = work()
        .then((outcome) => {
          if (outcome.status === "SUCCEEDED" && outcome.result.ok) {
            let run = kept.get(runId);
            if (run === undefined) {
              run = new Map();
              kept.set(runId, run);
              if (kept.size > KEPT_RUNS_MAX) {
                const oldest = kept.keys().next().value;
                if (oldest !== undefined) kept.delete(oldest);
              }
            }
            if (run.size < KEPT_PER_RUN) run.set(key, outcome);
          }
          return outcome;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, started);
      return started;
    },
    takeShared: (runId) => {
      const total = shared.get(runId) ?? 0;
      shared.delete(runId);
      kept.delete(runId);
      return total;
    },
  };
}
