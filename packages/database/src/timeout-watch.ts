import { databaseTimeoutsObserved } from "./round-trips.js";

/**
 * Launch readiness 7, for the request services (api, q-api): every
 * `intervalMs`, when this process saw at least `threshold` statements end in
 * 57014 since the last look, one structured error line with
 * `alert: "DB_TIMEOUTS"`. The workers report theirs inside their own
 * operational check. A count only: no statement text, no ids.
 */
export function watchDatabaseTimeouts(options: {
  readonly logger: {
    readonly error: (fields: Record<string, unknown>, message: string) => void;
  };
  readonly intervalMs?: number | undefined;
  readonly threshold?: number | undefined;
  readonly observed?: (() => number) | undefined;
}): { readonly check: () => number; readonly stop: () => void } {
  const observed = options.observed ?? databaseTimeoutsObserved;
  const threshold = options.threshold ?? 3;
  let seen = observed();
  const check = (): number => {
    const now = observed();
    const delta = now - seen;
    seen = now;
    if (delta >= threshold) {
      options.logger.error(
        { alert: "DB_TIMEOUTS", dbTimeouts: delta },
        "database statements timed out (57014) since the last check",
      );
    }
    return delta;
  };
  const timer = setInterval(check, options.intervalMs ?? 60_000);
  timer.unref();
  return { check, stop: () => clearInterval(timer) };
}
