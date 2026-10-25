/**
 * How a polling loop waits when it finds no work (Supabase egress
 * restriction, 24 Oct 2026).
 *
 * Every loop used to poll on a fixed 0.75–3 s interval whether or not
 * anything was waiting: tens of thousands of empty round trips a day per
 * loop. An idle loop now doubles its wait after each empty poll, from the
 * loop's own interval up to a ceiling, and drops back to its interval the
 * moment it finds work.
 *
 * Backing off must not make an upload slow, so a shared wake signal ends a
 * backed-off wait early:
 * - the database announces new work on WORKERS_WAKE_CHANNEL (an outbox
 *   event, a document job, a queued refresh), which covers the first hop;
 * - any loop that does work wakes the others, because one hop's output is
 *   the next hop's input (outbox → domain events → documents → outbox),
 *   all inside this process.
 * A wake never makes a loop poll faster than its own interval: it resets
 * the wait and ends a longer one, but a wait already at the interval runs
 * to completion. A storm of wakes therefore costs at most one poll per
 * interval per loop.
 */

export const IDLE_BACKOFF_MAX_MS = 30_000;

export type WakeSignal = {
  /** New work may exist: end every backed-off wait. */
  readonly wake: () => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createWakeSignal(): WakeSignal {
  const listeners = new Set<() => void>();
  return {
    wake: () => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** What a polling loop calls between polls. */
export type IdlePolicy = {
  /** The last poll found work: reset the wait (and wake the other loops). */
  readonly worked: () => void;
  /** The last poll found nothing, or failed: wait, then grow the next wait. */
  readonly idle: (signal: AbortSignal) => Promise<void>;
};

/** The old behaviour: the same interval after every empty poll. */
export function fixedInterval(
  intervalMs: number,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
): IdlePolicy {
  return {
    worked: () => undefined,
    idle: (signal) => sleep(intervalMs, signal),
  };
}

export function createIdleBackoff(options: {
  readonly minMs: number;
  readonly maxMs?: number | undefined;
  readonly wake?: WakeSignal | undefined;
  /** Injectable for tests: the timer the wait runs on. */
  readonly setTimer?:
    | ((run: () => void, ms: number) => { readonly clear: () => void })
    | undefined;
}): IdlePolicy & { readonly nextWaitMs: () => number } {
  const minMs = Math.max(1, options.minMs);
  const maxMs = Math.max(minMs, options.maxMs ?? IDLE_BACKOFF_MAX_MS);
  const setTimer =
    options.setTimer ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return { clear: () => clearTimeout(timer) };
    });
  let waitMs = minMs;
  // Set while this loop is the one doing the waking, so its own wake does
  // not cut its own next wait short.
  let waking = false;

  return {
    nextWaitMs: () => waitMs,
    worked: () => {
      waitMs = minMs;
      if (options.wake !== undefined) {
        waking = true;
        try {
          options.wake.wake();
        } finally {
          waking = false;
        }
      }
    },
    idle: (signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const current = waitMs;
        waitMs = Math.min(current * 2, maxMs);
        let unsubscribe = (): void => undefined;
        const finish = () => {
          timer.clear();
          unsubscribe();
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimer(finish, current);
        signal.addEventListener("abort", finish, { once: true });
        if (options.wake !== undefined) {
          unsubscribe = options.wake.subscribe(() => {
            if (waking) return;
            waitMs = minMs;
            // A wait at the interval runs out; only a backed-off one ends.
            if (current > minMs) finish();
          });
        }
      }),
  };
}
