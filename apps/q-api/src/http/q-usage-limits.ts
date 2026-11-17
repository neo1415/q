import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createSpeechThrottle } from "../voice/synthesis.js";

/**
 * Launch readiness 9: per-person limits on starting Q runs.
 *
 * - Per minute: a fixed window per (tenant, person), in this process (the
 *   same counter the speech throttle uses): a runaway client or a held-down
 *   key, not ordinary use (production's busiest minute was 8 runs).
 * - Per UTC day: counted from `q_runtime.runs` itself, so it holds across
 *   restarts and instances (the busiest person-day on record was 95).
 *
 * Keyed on the server-resolved actor; a client cannot choose its bucket.
 * A failed daily count admits and logs: the counter must never take Q down,
 * and the per-minute bound and the spend caps still hold meanwhile.
 * Voice session starts are limited where sessions are issued
 * (`createVoiceSessionBindings`), on the same principle.
 */

export type QUsageLimits = {
  readonly runsPerMinute: number;
  readonly runsPerDay: number;
};

export const DEFAULT_Q_USAGE_LIMITS: QUsageLimits = {
  runsPerMinute: 20,
  runsPerDay: 300,
};

/** Never off, never unbounded: a typo keeps the default. */
const BOUNDS = {
  runsPerMinute: { env: "CQ_Q_RUNS_PER_MINUTE", min: 1, max: 600 },
  runsPerDay: { env: "CQ_Q_RUNS_PER_DAY", min: 1, max: 100_000 },
} as const;

export function parseQUsageLimits(
  env: Readonly<Record<string, string | undefined>>,
): QUsageLimits {
  const read = (key: keyof QUsageLimits): number => {
    const bound = BOUNDS[key];
    const raw = env[bound.env]?.trim();
    if (raw === undefined || !/^\d+$/u.test(raw)) {
      return DEFAULT_Q_USAGE_LIMITS[key];
    }
    const value = Number(raw);
    return value >= bound.min && value <= bound.max
      ? value
      : DEFAULT_Q_USAGE_LIMITS[key];
  };
  return {
    runsPerMinute: read("runsPerMinute"),
    runsPerDay: read("runsPerDay"),
  };
}

/** A person asked Q more than their allowance; a 429 with plain words. */
export class QUsageLimitError extends Error {
  readonly errorCode = "Q_USAGE_LIMIT" as const;
  readonly scope: "MINUTE" | "DAY";
  readonly retryAfterSeconds: number;
  constructor(scope: "MINUTE" | "DAY", retryAfterSeconds: number) {
    super(
      scope === "MINUTE"
        ? "You've asked Q a lot in the last minute. Wait a moment, then try again."
        : "You've reached today's limit for questions to Q. It resets at midnight UTC.",
    );
    this.name = "QUsageLimitError";
    this.scope = scope;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type QRunLimiter = {
  /** Throws QUsageLimitError when this person may not start another run now. */
  readonly admit: (actor: ActorContext) => Promise<void>;
};

function utcDayStart(at: number): Date {
  const day = new Date(at);
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  );
}

export function createQRunLimiter(options: {
  readonly limits: QUsageLimits;
  /** Runs this person created in this tenant since `since`. */
  readonly runsSince: (actor: ActorContext, since: Date) => Promise<number>;
  readonly now?: (() => number) | undefined;
  readonly onCountFailure?: ((error: unknown) => void) | undefined;
}): QRunLimiter {
  const now = options.now ?? Date.now;
  const minute = createSpeechThrottle({
    quota: { limit: options.limits.runsPerMinute, windowMs: 60_000 },
    clock: now,
  });
  return {
    admit: async (actor) => {
      const at = now();
      const dayStart = utcDayStart(at);
      let today: number | undefined;
      try {
        today = await options.runsSince(actor, dayStart);
      } catch (error: unknown) {
        options.onCountFailure?.(error);
      }
      if (today !== undefined && today >= options.limits.runsPerDay) {
        const resetMs = dayStart.getTime() + 86_400_000 - at;
        throw new QUsageLimitError(
          "DAY",
          Math.max(1, Math.ceil(resetMs / 1000)),
        );
      }
      if (!minute.charge(`${actor.tenantId}:${actor.userId}`)) {
        throw new QUsageLimitError("MINUTE", 60);
      }
    },
  };
}

/**
 * The daily count, on the (tenant_id, actor_user_id, created_at) index.
 * Read-only; the actor's own ids, never a client-supplied one.
 */
export function createPostgresRunsSinceCounter(options: {
  readonly sql: DatabaseExecutor;
}): (actor: ActorContext, since: Date) => Promise<number> {
  return async (actor, since) => {
    const rows = await options.sql<{ n: number }[]>`
      select count(*)::int as n
        from q_runtime.runs
       where tenant_id = ${actor.tenantId}::uuid
         and actor_user_id = ${actor.userId}::uuid
         and created_at >= ${since.toISOString()}::timestamptz`;
    return rows[0]?.n ?? 0;
  };
}
