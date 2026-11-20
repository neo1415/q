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

/** When this process last recycled its pool; null when it never has. */
let lastRecycledAt: Date | null = null;

/**
 * The pool as an operator may see it (console System health, 19 Nov 2026):
 * counts and ages only, never statement text, kinds or ids. Undefined when
 * the executor is not a watched pool.
 */
export type DatabasePoolSnapshot = {
  readonly slots: number;
  readonly held: number;
  readonly waiting: number;
  readonly oldestHeldMs: number | null;
  readonly recycles: number;
  readonly lastRecycledAt: string | null;
};

/**
 * What can be measured of a pool, gated or not (20 Nov 2026: the workers'
 * heartbeat carried an empty pool). Behind the transaction pooler the
 * client is gated and every count above is known. Elsewhere (direct or
 * session mode) the driver keeps its own pool and exposes only its size,
 * so that is all this says: never a guessed "0 in use".
 */
export type DatabasePoolReading =
  | ({ readonly gated: true } & DatabasePoolSnapshot)
  | { readonly gated: false; readonly maxConnections: number };

export function databasePoolReading(
  sql: object,
): DatabasePoolReading | undefined {
  const snapshot = databasePoolSnapshot(sql);
  if (snapshot !== undefined) return { gated: true, ...snapshot };
  // postgres.js keeps its settings on `options`; the instrumented client
  // forwards the read to the driver.
  const options: unknown = Reflect.get(sql, "options");
  const max: unknown =
    typeof options === "object" && options !== null
      ? Reflect.get(options, "max")
      : undefined;
  return typeof max === "number" && Number.isInteger(max) && max > 0
    ? { gated: false, maxConnections: max }
    : undefined;
}

export function databasePoolSnapshot(
  sql: object,
): DatabasePoolSnapshot | undefined {
  const control = connectionPoolOf(sql);
  if (control === undefined) return undefined;
  const state = control.inspect();
  return {
    slots: state.slots,
    held: state.held,
    waiting: state.waiting,
    oldestHeldMs: state.oldestHeldMs,
    recycles: state.recycles,
    lastRecycledAt: lastRecycledAt?.toISOString() ?? null,
  };
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
    if (recycled) lastRecycledAt = new Date();
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
