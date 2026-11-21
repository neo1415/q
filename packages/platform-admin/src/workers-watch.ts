import type { DatabaseExecutor } from "@capital-q/database";

import type { OperatorAlert } from "./operator-alerts.js";

/**
 * W1-B (enterprise audit 21 Nov 2026, finding 5): who watches the watcher.
 * The workers run every operational check and alert on everything else, so
 * when they stop, nothing says so. q-api reads the workers' heartbeat
 * (platform_ops.service_heartbeats) on an interval and, when it is older
 * than `staleMs` or missing, sends one operator alert through the existing
 * channel (de-duplicated per key, then quiet for its cooldown). A fresh
 * heartbeat says nothing; a read that fails is logged, never an alert of
 * its own (q-api's database trouble has its own alerts).
 */
export const WORKERS_HEARTBEAT_STALE_MS = 5 * 60_000;
export const WORKERS_WATCH_INTERVAL_MS = 60_000;

export const WORKERS_HEARTBEAT_ALERT_KEY = "ops:workers-heartbeat-stale";

/** The alert for this reading, or null when the workers are alive. */
export function workersHeartbeatAlert(input: {
  /** The workers' last heartbeat; null when none was ever recorded. */
  readonly beatAt: Date | null;
  readonly now: Date;
  readonly staleMs?: number | undefined;
}): OperatorAlert | null {
  const staleMs = input.staleMs ?? WORKERS_HEARTBEAT_STALE_MS;
  if (input.beatAt === null) {
    return {
      key: WORKERS_HEARTBEAT_ALERT_KEY,
      subject: "The workers have never reported in",
      text: "No heartbeat from the workers is on record, so reminders, emails, document jobs and the operational checks may not be running. Check the workers' deployment.",
    };
  }
  const age = input.now.getTime() - input.beatAt.getTime();
  if (age <= staleMs) return null;
  const minutes = Math.round(age / 60_000);
  return {
    key: WORKERS_HEARTBEAT_ALERT_KEY,
    subject: "The workers have stopped reporting",
    text: `The workers' last heartbeat was ${String(minutes)} minute(s) ago (at ${input.beatAt.toISOString()}). Reminders, emails, document jobs and the operational checks may have stopped. Check the workers' deployment and logs.`,
  };
}

/** The workers' last heartbeat time, or null when none is on record. */
export function createPostgresWorkersBeat(
  sql: DatabaseExecutor,
): () => Promise<Date | null> {
  return async () => {
    const rows = await sql<{ beat_at: Date | string }[]>`
      select beat_at from platform_ops.service_heartbeats
       where service = 'workers'`;
    const row = rows[0];
    return row === undefined ? null : new Date(row.beat_at);
  };
}

/**
 * Starts the watch; returns its stop. One read a minute, unref'd so it
 * never holds the process open; each alert goes through `alert`.
 */
export function watchWorkersHeartbeat(options: {
  readonly readBeat: () => Promise<Date | null>;
  readonly alert: (alert: OperatorAlert) => Promise<boolean>;
  readonly logger: {
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
  readonly now?: (() => Date) | undefined;
  readonly intervalMs?: number | undefined;
  readonly staleMs?: number | undefined;
}): () => void {
  const now = options.now ?? (() => new Date());
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const beatAt = await options.readBeat();
      const alert = workersHeartbeatAlert({
        beatAt,
        now: now(),
        staleMs: options.staleMs,
      });
      if (alert !== null) await options.alert(alert);
    } catch (error: unknown) {
      options.logger.warn(
        { err: error },
        "the workers' heartbeat could not be read",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, options.intervalMs ?? WORKERS_WATCH_INTERVAL_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
  };
}
