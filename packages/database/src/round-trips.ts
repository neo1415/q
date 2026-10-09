import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Database round trips per unit of work (SUB-SECOND; asked for by G).
 *
 * On hosted, a round trip to Supabase costs 15-20 ms, so the number of
 * them a Q run makes before it can start answering is the latency budget.
 * A counter is bound to an async context (`withRoundTripCounter`), and
 * every query issued inside it, on the request client or the checkpoint
 * pool, is counted. `mark` records the count at a named moment, so a run
 * can report "N round trips before the answer started".
 *
 * Counts queries, not wall time, and nothing about their content.
 */

export type RoundTripCounter = {
  count: number;
  /** Round trips so far at each named moment. */
  readonly marks: Record<string, number>;
  /** Milliseconds since the counter was created, at each named moment. */
  readonly markedAtMs: Record<string, number>;
  readonly startedAt: number;
};

const storage = new AsyncLocalStorage<RoundTripCounter>();

export function createRoundTripCounter(): RoundTripCounter {
  return { count: 0, marks: {}, markedAtMs: {}, startedAt: performance.now() };
}

export function withRoundTripCounter<T>(
  counter: RoundTripCounter,
  work: () => T,
): T {
  return storage.run(counter, work);
}

/** One query was sent. A no-op outside a counted context. */
export function countRoundTrip(): void {
  const counter = storage.getStore();
  if (counter !== undefined) counter.count += 1;
}

/** Records the count so far under a label, once (the first time wins). */
export function markRoundTrips(label: string): void {
  const counter = storage.getStore();
  if (counter !== undefined && counter.marks[label] === undefined) {
    counter.marks[label] = counter.count;
    counter.markedAtMs[label] = Math.round(
      performance.now() - counter.startedAt,
    );
  }
}

export function currentRoundTripCounter(): RoundTripCounter | undefined {
  return storage.getStore();
}
