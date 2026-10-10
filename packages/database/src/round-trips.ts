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
  /**
   * Round trips per phase (R5): the innermost `withRoundTripPhase` label
   * the query was sent under, or "other". Sums to `count`.
   */
  readonly phases: Record<string, number>;
  /**
   * Local diagnosis only (CQ_ROUND_TRIP_TRACE=1 with the trace loader):
   * queries sent, per phase and calling source location, so a sink no
   * phase names can still be found. Empty otherwise.
   */
  readonly sites: Record<string, number>;
  readonly startedAt: number;
};

const storage = new AsyncLocalStorage<RoundTripCounter>();
const phaseStorage = new AsyncLocalStorage<string>();
const TRACE = process.env["CQ_ROUND_TRIP_TRACE"] === "1";

export function createRoundTripCounter(): RoundTripCounter {
  return {
    count: 0,
    marks: {},
    markedAtMs: {},
    phases: {},
    sites: {},
    startedAt: performance.now(),
  };
}

/**
 * Attributes the round trips `work` sends to `label` (the innermost label
 * wins). Labels are fixed phase or tool names, never content. A plain call
 * through when no counter is bound, so it costs nothing outside a run.
 */
export function withRoundTripPhase<T>(label: string, work: () => T): T {
  if (storage.getStore() === undefined) return work();
  return phaseStorage.run(label, work);
}

/**
 * The first three stack frames outside the database client and
 * node_modules, innermost first: the reading and who asked for it.
 */
function callSite(raw?: string): string {
  const stack = (raw ?? new Error().stack)?.split("\n").slice(1) ?? [];
  const sites: string[] = [];
  for (const frame of stack) {
    if (
      frame.includes("node_modules") ||
      frame.includes("/database/") ||
      frame.includes("node:")
    ) {
      continue;
    }
    const match = /\/(?:packages|apps)\/(.+?):(\d+):\d+\)?$/.exec(frame.trim());
    if (match === null) continue;
    sites.push(
      `${(match[1] ?? "").replace(/^([^/]+)\/(?:dist|src)\/(?:infrastructure\/)?/, "$1/")}:${match[2] ?? ""}`,
    );
    if (sites.length === 3) break;
  }
  return sites.length === 0 ? "unknown" : sites.join(" < ");
}

export function withRoundTripCounter<T>(
  counter: RoundTripCounter,
  work: () => T,
): T {
  return storage.run(counter, work);
}

/** One query was sent. A no-op outside a counted context. */
export function countRoundTrip(phase?: string): void {
  const counter = storage.getStore();
  if (counter === undefined) return;
  counter.count += 1;
  const label = phase ?? phaseStorage.getStore() ?? "other";
  counter.phases[label] = (counter.phases[label] ?? 0) + 1;
}

// Local diagnosis only (scripts/recovery/round-trip-trace.mjs): a loader
// makes the driver call `__cqQuerySent` as each query is handed to a
// connection, in the caller's own async context, with the stack from where
// the query was written. The debug hook above runs where the driver
// writes, which for a query that waited for a free connection is that
// socket's context, not the caller's: on a busy pool it counts other
// requests' queries to whichever run opened the socket. The sites below
// are exact; `count` is approximate under contention.
if (TRACE) {
  Error.stackTraceLimit = 40;
  (globalThis as { __cqQuerySent?: (stack?: string) => void }).__cqQuerySent = (
    stack,
  ) => {
    const counter = storage.getStore();
    if (counter === undefined) return;
    const site = `${phaseStorage.getStore() ?? "other"} | ${callSite(stack)}`;
    counter.sites[site] = (counter.sites[site] ?? 0) + 1;
  };
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
