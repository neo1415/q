import { QClientActionToolResultSchema } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * Batch 14 (W1, instant writes): which runs had a tool commit a change to
 * Capital Q's data, so the run's completed event can tell the page to read
 * that data again (`dataChanged`).
 *
 * Decided from the executor's classification, never from a tool's name: a
 * SUCCEEDED SIDE_EFFECT call is a committed write (a Save or Pass, a note,
 * a proposal prepared for approval -- which the person's pages now list),
 * except two kinds whose SIDE_EFFECT is not a write here:
 * - a screen action (theme, scroll, open a page): the result carries the
 *   client action for the screen to perform; nothing on the server changed;
 * - an action that reports it did not happen (NOT_DONE, ONE_PER_TURN).
 *
 * Over-reporting costs a page one re-read; under-reporting leaves it stale,
 * so anything else that succeeded counts.
 */
export type QRunWriteLedger = {
  /** Called by the executor for every finished call. */
  readonly note: (runId: string, outcome: QToolCallOutcome) => void;
  /** Whether the run committed a write; the run's entry is then dropped. */
  readonly take: (runId: string) => boolean;
};

const NOT_DONE: ReadonlySet<string> = new Set(["NOT_DONE", "ONE_PER_TURN"]);

export function committedWrite(outcome: QToolCallOutcome): boolean {
  if (outcome.status !== "SUCCEEDED") return false;
  if (outcome.classification !== "SIDE_EFFECT") return false;
  if (!outcome.result.ok) return false;
  const data: unknown = outcome.result.data;
  if (QClientActionToolResultSchema.safeParse(data).success) return false;
  if (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    typeof data.status === "string" &&
    NOT_DONE.has(data.status)
  ) {
    return false;
  }
  return true;
}

/** Bounded: a run that never completes cannot grow it without end. */
export function createRunWriteLedger(
  options: { readonly maxRuns?: number } = {},
): QRunWriteLedger {
  const max = options.maxRuns ?? 2_048;
  const wrote = new Set<string>();
  return {
    note: (runId, outcome) => {
      if (!committedWrite(outcome) || wrote.has(runId)) return;
      wrote.add(runId);
      if (wrote.size > max) {
        const oldest = wrote.values().next().value;
        if (oldest !== undefined) wrote.delete(oldest);
      }
    },
    take: (runId) => wrote.delete(runId),
  };
}
