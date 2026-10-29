/**
 * The research path's clock and deadlines (acceptance gate 2026-10-29).
 *
 * Deep research decides by time: a line of enquiry is skipped at its
 * round's deadline, page reads are given up past their budget, facts stop
 * being read when the job's time is spent. A recording replayed in a
 * second took another path than the live run it recorded, so every clock
 * reading and every deadline on the research path goes through this one
 * port: production passes the system's, and the acceptance gate a
 * recorded one that hands the replay the same readings and deadlines.
 */

/** A deadline: its signal aborts (TimeoutError) after `ms` unless cancelled. */
export type ResearchTimeout = {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
};

export type ResearchTime = {
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly timeout: (ms: number) => ResearchTimeout;
};

/** The system clock and timers: what production runs on. */
export const SYSTEM_RESEARCH_TIME: ResearchTime = {
  now: () => Date.now(),
  timeout: (ms) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      );
    }, ms);
    return { signal: controller.signal, cancel: () => clearTimeout(timer) };
  },
};

/** A promise that rejects with `failure()` once `signal` aborts. */
export function rejectOnAbort(
  signal: AbortSignal,
  failure: () => Error,
): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(failure());
      return;
    }
    signal.addEventListener("abort", () => reject(failure()), { once: true });
  });
}
