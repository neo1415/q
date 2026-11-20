/**
 * A safety-net sweep that waits longer while it keeps finding nothing
 * (cost pass, 20 Nov 2026; docs/ai-handoff/audits/2026-11-20-cost-pass.md).
 *
 * The knowledge reconciler repairs projections that the same-transaction
 * triggers missed. It ran every 10 minutes whatever it found. After
 * `idleRunsBeforeBackoff` consecutive empty runs, each wait doubles from
 * `baseMs` up to `maxMs`; the first run that finds work drops it back to
 * `baseMs`, and a failed run counts as not idle (it retries at `baseMs`).
 *
 * Bound: a missed change is repaired at most `maxMs` after it happens
 * (plus one run's duration). The triggers remain the primary path, so a
 * normal change is current in the same transaction as before.
 */

export type IdleSweepOptions = {
  readonly baseMs: number;
  readonly maxMs: number;
  /** Consecutive empty runs before the wait starts to grow. */
  readonly idleRunsBeforeBackoff: number;
};

/**
 * The knowledge reconciler: every 10 minutes; after 3 empty runs, 20, 40,
 * then 60 minutes at most. A missed change is repaired within an hour.
 */
export const KNOWLEDGE_RECONCILE_SCHEDULE: IdleSweepOptions = {
  baseMs: 10 * 60 * 1000,
  maxMs: 60 * 60 * 1000,
  idleRunsBeforeBackoff: 3,
};

export type IdleSweepSchedule = {
  /** Records one run's outcome and returns the wait before the next run. */
  readonly after: (outcome: { readonly found: number } | "FAILED") => number;
};

export function createIdleSweepSchedule(
  options: IdleSweepOptions,
): IdleSweepSchedule {
  const baseMs = Math.max(1, options.baseMs);
  const maxMs = Math.max(baseMs, options.maxMs);
  const threshold = Math.max(1, options.idleRunsBeforeBackoff);
  let idleRuns = 0;
  return {
    after: (outcome) => {
      if (outcome === "FAILED" || outcome.found > 0) {
        idleRuns = 0;
        return baseMs;
      }
      idleRuns += 1;
      const doublings = Math.max(0, idleRuns - threshold + 1);
      // Capped before multiplying: no overflow however long it stays idle.
      return Math.min(maxMs, baseMs * 2 ** Math.min(doublings, 30));
    },
  };
}

/**
 * The sweep loop: waits `firstDelayMs`, runs, then waits what the
 * schedule says before each next run. The timer is unref'd (it never holds the process
 * open); `stop` ends the loop after the run in flight.
 */
export function startIdleSweep(input: {
  readonly run: () => Promise<number>;
  readonly schedule: IdleSweepSchedule;
  readonly firstDelayMs: number;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly setTimer?:
    | ((run: () => void, ms: number) => { readonly clear: () => void })
    | undefined;
}): { readonly stop: () => void } {
  const setTimer =
    input.setTimer ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      timer.unref();
      return { clear: () => clearTimeout(timer) };
    });
  let stopped = false;
  let pending: { readonly clear: () => void } | null = null;
  const tick = async () => {
    pending = null;
    if (stopped) return;
    let wait: number;
    try {
      wait = input.schedule.after({ found: await input.run() });
    } catch (error: unknown) {
      input.onError?.(error);
      wait = input.schedule.after("FAILED");
    }
    if (!stopped) pending = setTimer(() => void tick(), wait);
  };
  pending = setTimer(() => void tick(), input.firstDelayMs);
  return {
    stop: () => {
      stopped = true;
      pending?.clear();
      pending = null;
    },
  };
}
