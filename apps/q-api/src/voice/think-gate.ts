/**
 * When a think request may start work (L1 latency sweep, 2026-10-06).
 *
 * Hosted 2026-10-05: 58 of 113 voice turns ended INTERRUPTED. In one
 * session 35 of 38 turns were cancelled; think requests arrived every
 * 250-500 ms for seconds at a time (the provider ending the person's turn
 * at each pause, then asking again as the utterance grew), and 23 of the
 * cancelled turns had already started model calls (44.8 s of model time
 * thrown away), each one creating and cancelling a Q run on the way.
 *
 * The gate is adaptive, so a normal turn pays nothing:
 *
 *  - A think on a quiet line (none within `burstWindowMs`) starts NOW.
 *  - A think that arrives while the line is in a burst waits `settleMs`
 *    first. If the provider asks again in that time, this one is dropped
 *    by the route (its signal aborts) before anything was created, read
 *    or said; the last request of the burst answers the whole utterance.
 *
 * Re-sends of the SAME words are not gated here: the route lets them
 * join the turn already answering (think.ts), which costs nothing.
 */
export type ThinkAdmission = "NOW" | "SETTLED" | "DROPPED";

export type ThinkGate = {
  readonly admit: (
    line: string,
    signal: AbortSignal,
  ) => Promise<ThinkAdmission>;
};

/** A burst: the previous think on the line arrived less than this ago. */
export const THINK_BURST_WINDOW_MS = 1_500;
/** How long a think in a burst waits to see whether another follows. */
export const THINK_SETTLE_MS = 350;
const LINES_MAX = 512;

export function createThinkGate(
  options: {
    readonly burstWindowMs?: number | undefined;
    readonly settleMs?: number | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): ThinkGate {
  const burstWindowMs = options.burstWindowMs ?? THINK_BURST_WINDOW_MS;
  const settleMs = options.settleMs ?? THINK_SETTLE_MS;
  const now = options.now ?? Date.now;
  const lastArrival = new Map<string, number>();
  return {
    admit: async (line, signal) => {
      const arrived = now();
      const previous = lastArrival.get(line);
      lastArrival.delete(line);
      lastArrival.set(line, arrived);
      while (lastArrival.size > LINES_MAX) {
        const oldest = lastArrival.keys().next().value;
        if (oldest === undefined) break;
        lastArrival.delete(oldest);
      }
      if (previous === undefined || arrived - previous >= burstWindowMs) {
        return "NOW";
      }
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, settleMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return signal.aborted ? "DROPPED" : "SETTLED";
    },
  };
}
