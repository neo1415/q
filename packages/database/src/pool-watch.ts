import { connectionPoolOf, type ConnectionPoolState } from "./round-trips.js";

/**
 * Pool exhaustions this process detected (and recycled, where it could)
 * since it started. A monotonic count with no ids or text, read by the
 * workers' operational check, which compares two readings.
 */
let exhaustionsObserved = 0;

export function databasePoolExhaustionsObserved(): number {
  return exhaustionsObserved;
}

/** Below this, a slot held "too long" could still be honest work. */
const MIN_STUCK_AFTER_MS = 30_000;

/**
 * Incident 19 Nov 2026: q-api's pool behind the transaction pooler wedged
 * (every connection held by a statement the pooler would never answer),
 * and every statement after that failed as 57014 for 72 minutes, until
 * the service was restarted by hand. A restart was the whole fix, so the
 * process now does it to its own pool.
 *
 * Every `intervalMs`, the gate is looked at. When every slot is held and
 * even the most recently taken one has been held for `stuckAfterMs`, the
 * pool is not busy, it is wedged: nothing has been given back for that
 * long. Then, once per occurrence:
 *
 *   - one structured error line with `alert: "DB_POOL_EXHAUSTED"` (counts
 *     and ages only, never statement text or ids);
 *   - the pool is recycled: a fresh driver serves from the next statement
 *     on, and the old one's connections are destroyed, so every holder
 *     (a wedged statement, a transaction stuck in ROLLBACK, a transaction
 *     waiting on something outside the database) fails with a CONNECTION
 *     error and unwinds instead of starving the service;
 *   - `onExhausted` (q-api: the operator channel) is told.
 *
 * `stuckAfterMs` defaults to twice the client deadline, at least 30 s: a
 * statement holds its slot at most a little past its deadline when the
 * server and pooler answer, so twice that is never honest work.
 */
export function watchConnectionPool(options: {
  readonly sql: object;
  readonly logger: {
    readonly error: (fields: Record<string, unknown>, message: string) => void;
  };
  readonly intervalMs?: number | undefined;
  readonly stuckAfterMs?: number | undefined;
  readonly onExhausted?:
    | ((event: {
        readonly state: ConnectionPoolState;
        readonly recycled: boolean;
      }) => void)
    | undefined;
}): {
  readonly check: () => ConnectionPoolState | undefined;
  readonly stop: () => void;
} {
  const control = connectionPoolOf(options.sql);
  const stuckAfterMs =
    options.stuckAfterMs ??
    Math.max(MIN_STUCK_AFTER_MS, 2 * (control?.deadlineMs ?? 0));
  const check = (): ConnectionPoolState | undefined => {
    if (control === undefined) return undefined;
    const state = control.inspect();
    const wedged =
      state.slots > 0 &&
      state.held >= state.slots &&
      state.youngestHeldMs !== null &&
      state.youngestHeldMs >= stuckAfterMs;
    if (!wedged) return state;
    exhaustionsObserved += 1;
    const recycled = control.recycle();
    options.logger.error(
      {
        alert: "DB_POOL_EXHAUSTED",
        slots: state.slots,
        held: state.held,
        waiting: state.waiting,
        oldestHeldMs: state.oldestHeldMs,
        youngestHeldMs: state.youngestHeldMs,
        heldByKind: state.heldByKind,
        stuckAfterMs,
        recycled,
        recycles: state.recycles + (recycled ? 1 : 0),
      },
      recycled
        ? "database pool exhausted: every connection held past its limit; the pool was recycled"
        : "database pool exhausted: every connection held past its limit; it could not be recycled",
    );
    try {
      options.onExhausted?.({ state, recycled });
    } catch {
      // The alert line above is already out.
    }
    return state;
  };
  if (control === undefined) {
    return { check, stop: () => undefined };
  }
  const timer = setInterval(check, options.intervalMs ?? 5_000);
  timer.unref();
  return { check, stop: () => clearInterval(timer) };
}
