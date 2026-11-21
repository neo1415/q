import type { DatabaseExecutor } from "@capital-q/database";
import type { OperatorAlert } from "@capital-q/platform-admin";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

import type { Heartbeat, LastAlert } from "./heartbeat.js";
import type { createHealthWatch, ProbeResult } from "./health-watch.js";

/**
 * Launch readiness item 7: one operational check the workers run on an
 * interval. It reads (never writes) a few bounded aggregates and, when any
 * crosses its threshold, emits ONE structured error line carrying
 * `alert: "OPS_CHECK"` and the finding codes, then hands each finding to the
 * existing operator channel (`createOperatorAlerts`: an `qAlert: "OPERATOR"`
 * line and an email to platform admins, de-duplicated per key for six
 * hours). No new service, no new credential, no customer content: run ids,
 * provider codes, counts and dollars only.
 *
 * Findings:
 * - Q_RUN_STUCK: a live run with no event (or start) for longer than
 *   `stuckRunMs`. Runs waiting on a person (AWAITING_INPUT/APPROVAL) are
 *   waiting, not stuck.
 * - Q_RUN_FAILURE_RATE: the share of runs created in the window that ended
 *   FAILED, once enough runs exist to make a rate mean something.
 * - DB_TIMEOUTS: statements this worker process saw end in 57014 since the
 *   previous check (q-api logs its own; see the runbook).
 * - DB_POOL_EXHAUSTED: this worker process's connection pool had every
 *   slot held past its limit and was recycled by `watchConnectionPool`
 *   since the previous check (q-api alerts on its own; 19 Nov 2026).
 * - MODEL_PROVIDER_FAILURE_RATE: per provider, failed attempts in the
 *   window, not counting our own refusals (cancelled, over budget, policy).
 * - MODEL_SPEND_NEAR_CAP: today's ledger spend against the aggregate daily
 *   cap every gateway enforces (`CQ_MODEL_DAILY_SPEND_CAP_USD`).
 */

export const OPS_CHECK_ALERT = "OPS_CHECK" as const;

export type OpsFindingCode =
  | "Q_RUN_STUCK"
  | "Q_RUN_FAILURE_RATE"
  | "DB_TIMEOUTS"
  | "DB_POOL_EXHAUSTED"
  | "MODEL_PROVIDER_FAILURE_RATE"
  | "MODEL_SPEND_NEAR_CAP"
  // W1-B (health-watch.ts): a service failing its health check in a row,
  // and a service's share of server errors over its window.
  | "SERVICE_UNHEALTHY"
  | "ERROR_RATE_SPIKE";

export type OpsThresholds = {
  readonly intervalMs: number;
  readonly stuckRunMs: number;
  readonly windowMs: number;
  readonly failedRunRate: number;
  readonly failedRunMinRuns: number;
  readonly dbTimeoutsPerCheck: number;
  readonly providerFailureRate: number;
  readonly providerMinAttempts: number;
  /** Fraction of the daily cap at which spend is said. */
  readonly spendAlertFraction: number;
};

export const DEFAULT_OPS_THRESHOLDS: OpsThresholds = {
  intervalMs: 60_000,
  stuckRunMs: 2 * 60_000,
  windowMs: 15 * 60_000,
  failedRunRate: 0.25,
  failedRunMinRuns: 8,
  dbTimeoutsPerCheck: 3,
  providerFailureRate: 0.5,
  providerMinAttempts: 20,
  spendAlertFraction: 0.8,
};

type Bound = {
  readonly env: string;
  readonly key: keyof OpsThresholds;
  readonly min: number;
  readonly max: number;
};

const BOUNDS: readonly Bound[] = [
  {
    env: "CQ_OPS_CHECK_INTERVAL_MS",
    key: "intervalMs",
    min: 15_000,
    max: 3_600_000,
  },
  {
    env: "CQ_OPS_STUCK_RUN_MS",
    key: "stuckRunMs",
    min: 30_000,
    max: 3_600_000,
  },
  { env: "CQ_OPS_WINDOW_MS", key: "windowMs", min: 60_000, max: 86_400_000 },
  { env: "CQ_OPS_FAILED_RUN_RATE", key: "failedRunRate", min: 0.01, max: 1 },
  {
    env: "CQ_OPS_FAILED_RUN_MIN_RUNS",
    key: "failedRunMinRuns",
    min: 1,
    max: 10_000,
  },
  {
    env: "CQ_OPS_DB_TIMEOUTS_PER_CHECK",
    key: "dbTimeoutsPerCheck",
    min: 1,
    max: 100_000,
  },
  {
    env: "CQ_OPS_PROVIDER_FAILURE_RATE",
    key: "providerFailureRate",
    min: 0.01,
    max: 1,
  },
  {
    env: "CQ_OPS_PROVIDER_MIN_ATTEMPTS",
    key: "providerMinAttempts",
    min: 1,
    max: 100_000,
  },
  {
    env: "CQ_OPS_SPEND_ALERT_FRACTION",
    key: "spendAlertFraction",
    min: 0.1,
    max: 1,
  },
];

/**
 * Thresholds from the environment. A value that is not a number within its
 * bounds keeps the default and is reported, so a typo can never switch a
 * check off.
 */
export function parseOpsThresholds(
  env: Readonly<Record<string, string | undefined>>,
): { readonly thresholds: OpsThresholds; readonly invalid: readonly string[] } {
  const thresholds: Record<keyof OpsThresholds, number> = {
    ...DEFAULT_OPS_THRESHOLDS,
  };
  const invalid: string[] = [];
  for (const bound of BOUNDS) {
    const raw = env[bound.env]?.trim();
    if (raw === undefined || raw === "") continue;
    const value = /^\d+(\.\d+)?$/u.test(raw) ? Number(raw) : Number.NaN;
    if (Number.isFinite(value) && value >= bound.min && value <= bound.max) {
      thresholds[bound.key] = value;
    } else {
      invalid.push(bound.env);
    }
  }
  return { thresholds, invalid };
}

export type OpsReading = {
  readonly stuckRuns: readonly {
    readonly runId: string;
    readonly status: string;
    readonly idleMs: number;
  }[];
  readonly recentRuns: { readonly total: number; readonly failed: number };
  readonly providers: readonly {
    readonly providerCode: string;
    readonly attempts: number;
    readonly failed: number;
  }[];
  readonly spendToday: readonly {
    readonly providerCode: string;
    readonly usd: number;
  }[];
};

export type OpsFinding = {
  readonly code: OpsFindingCode;
  /** De-duplication key for the operator channel. */
  readonly key: string;
  readonly subject: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

const usd = (value: number): string => `USD ${value.toFixed(2)}`;
const pct = (value: number): string => `${String(Math.round(value * 100))}%`;

/** Pure: what the reading says, against the thresholds. */
export function assessOps(input: {
  readonly reading: OpsReading;
  readonly dbTimeoutsSinceLastCheck: number;
  /** Pool exhaustions detected since the last check; absent: none. */
  readonly dbPoolExhaustionsSinceLastCheck?: number | undefined;
  readonly thresholds: OpsThresholds;
  readonly dailyCapUsd: number | undefined;
}): readonly OpsFinding[] {
  const { reading, thresholds } = input;
  const findings: OpsFinding[] = [];

  if (reading.stuckRuns.length > 0) {
    const oldest = reading.stuckRuns[0];
    findings.push({
      code: "Q_RUN_STUCK",
      key: "ops:q-run-stuck",
      subject: "Q runs are stuck",
      text: `${String(reading.stuckRuns.length)} Q run(s) have made no progress for over ${String(Math.round(thresholds.stuckRunMs / 1000))} s (oldest ${String(Math.round((oldest?.idleMs ?? 0) / 1000))} s, run ${oldest?.runId ?? "?"}).`,
      fields: {
        stuckRuns: reading.stuckRuns.length,
        stuckRunIds: reading.stuckRuns.slice(0, 5).map((run) => run.runId),
        oldestIdleMs: Math.round(oldest?.idleMs ?? 0),
      },
    });
  }

  const { total, failed } = reading.recentRuns;
  if (total >= thresholds.failedRunMinRuns) {
    const rate = failed / total;
    if (rate >= thresholds.failedRunRate) {
      findings.push({
        code: "Q_RUN_FAILURE_RATE",
        key: "ops:q-run-failure-rate",
        subject: "Many Q runs are failing",
        text: `${String(failed)} of ${String(total)} Q runs in the last ${String(Math.round(thresholds.windowMs / 60_000))} minutes failed (${pct(rate)}).`,
        fields: { runsTotal: total, runsFailed: failed, failedRate: rate },
      });
    }
  }

  if (input.dbTimeoutsSinceLastCheck >= thresholds.dbTimeoutsPerCheck) {
    findings.push({
      code: "DB_TIMEOUTS",
      key: "ops:db-timeouts",
      subject: "Database statements are timing out",
      text: `${String(input.dbTimeoutsSinceLastCheck)} database statements in the workers timed out (57014) since the last check.`,
      fields: { dbTimeouts: input.dbTimeoutsSinceLastCheck },
    });
  }

  const exhaustions = input.dbPoolExhaustionsSinceLastCheck ?? 0;
  if (exhaustions > 0) {
    findings.push({
      code: "DB_POOL_EXHAUSTED",
      key: "ops:db-pool-exhausted",
      subject: "The workers' database pool was exhausted",
      text: `The workers' database pool had every connection held past its limit ${String(exhaustions)} time(s) since the last check and was recycled.`,
      fields: { dbPoolExhaustions: exhaustions },
    });
  }

  for (const provider of reading.providers) {
    if (provider.attempts < thresholds.providerMinAttempts) continue;
    const rate = provider.failed / provider.attempts;
    if (rate < thresholds.providerFailureRate) continue;
    findings.push({
      code: "MODEL_PROVIDER_FAILURE_RATE",
      key: `ops:provider-failure-rate:${provider.providerCode}`,
      subject: `Model provider ${provider.providerCode} is failing`,
      text: `${provider.providerCode}: ${String(provider.failed)} of ${String(provider.attempts)} model calls in the last ${String(Math.round(thresholds.windowMs / 60_000))} minutes failed (${pct(rate)}).`,
      fields: {
        provider: provider.providerCode,
        attempts: provider.attempts,
        failed: provider.failed,
        failedRate: rate,
      },
    });
  }

  if (input.dailyCapUsd !== undefined) {
    const spent = reading.spendToday.reduce((sum, row) => sum + row.usd, 0);
    if (spent >= input.dailyCapUsd * thresholds.spendAlertFraction) {
      const byProvider = Object.fromEntries(
        reading.spendToday.map((row) => [
          row.providerCode,
          Number(row.usd.toFixed(4)),
        ]),
      );
      findings.push({
        code: "MODEL_SPEND_NEAR_CAP",
        key: `ops:spend-near-cap:${spent >= input.dailyCapUsd ? "reached" : "near"}`,
        subject:
          spent >= input.dailyCapUsd
            ? "The daily model spend cap is reached"
            : "Model spend is near the daily cap",
        text: `Model spend today is ${usd(spent)} against the daily cap of ${usd(input.dailyCapUsd)} (${Object.entries(
          byProvider,
        )
          .map(([code, value]) => `${code} ${usd(value)}`)
          .join(
            ", ",
          )}). Past the cap, new model requests are refused until 00:00 UTC.`,
        fields: {
          spentTodayUsd: Number(spent.toFixed(4)),
          dailyCapUsd: input.dailyCapUsd,
          spendByProvider: byProvider,
        },
      });
    }
  }
  return findings;
}

/** Live statuses that are the engine's to move; waiting on a person is not stuck. */
const WORKING_STATUSES = [
  "RECEIVED",
  "PREFLIGHT",
  "CONTEXT_RESOLUTION",
  "POLICY_CHECK",
  "PLANNING",
  "RETRIEVAL",
  "SPECIALIST_EXECUTION",
  "SYNTHESIS",
  "VERIFICATION",
  "ACTION_EXECUTION",
  "CANCEL_REQUESTED",
] as const;

/** Our own refusals, not a provider failing. */
const NOT_PROVIDER_FAILURES = [
  "CANCELLED",
  "BUDGET_EXCEEDED",
  "POLICY_INELIGIBLE",
];

function utcDayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

/**
 * Four read-only, bounded aggregates. Stuck runs look back a day at most
 * and return at most 20 rows; everything else is a grouped count over the
 * window or today. Spend is summed in SQL and returned as text.
 */
export function createPostgresOpsReader(options: {
  readonly sql: DatabaseExecutor;
}): (input: {
  readonly now: Date;
  readonly thresholds: OpsThresholds;
}) => Promise<OpsReading> {
  const { sql } = options;
  return async ({ now, thresholds }) => {
    const idleSince = new Date(now.getTime() - thresholds.stuckRunMs);
    const lookback = new Date(now.getTime() - 86_400_000);
    const windowStart = new Date(now.getTime() - thresholds.windowMs);
    const dayStart = utcDayStart(now);
    const stuck = await sql<
      { run_id: string; status: string; last_at: Date | string }[]
    >`
      select r.id::text as run_id, r.status,
             coalesce(e.last_at, r.started_at, r.created_at) as last_at
        from q_runtime.runs r
        left join lateral (
          select max(ev.occurred_at) as last_at
            from q_runtime.run_events ev
           where ev.tenant_id = r.tenant_id and ev.run_id = r.id
        ) e on true
       where r.status in ${sql([...WORKING_STATUSES])}
         and r.created_at >= ${lookback.toISOString()}::timestamptz
         and coalesce(e.last_at, r.started_at, r.created_at)
             < ${idleSince.toISOString()}::timestamptz
       order by 3 asc
       limit 20`;
    const runs = await sql<{ total: number; failed: number }[]>`
      select count(*)::int as total,
             (count(*) filter (where status = 'FAILED'))::int as failed
        from q_runtime.runs
       where created_at >= ${windowStart.toISOString()}::timestamptz`;
    const providers = await sql<
      { provider_code: string; attempts: number; failed: number }[]
    >`
      select p.code as provider_code,
             count(*)::int as attempts,
             (count(*) filter (
               where not u.success
                 and u.error_code not in ${sql(NOT_PROVIDER_FAILURES)}))::int as failed
        from ai_ops.model_usage u
        join ai_ops.providers p on p.id = u.provider_id
       where u.occurred_at >= ${windowStart.toISOString()}::timestamptz
       group by p.code`;
    const spend = await sql<{ provider_code: string; usd: string }[]>`
      select p.code as provider_code,
             coalesce(sum(u.cost_usd), 0)::text as usd
        from ai_ops.model_usage u
        join ai_ops.providers p on p.id = u.provider_id
       where u.occurred_at >= ${dayStart.toISOString()}::timestamptz
       group by p.code`;
    return {
      stuckRuns: stuck.map((row) => ({
        runId: row.run_id,
        status: row.status,
        idleMs: now.getTime() - new Date(row.last_at).getTime(),
      })),
      recentRuns: { total: runs[0]?.total ?? 0, failed: runs[0]?.failed ?? 0 },
      providers: providers.map((row) => ({
        providerCode: row.provider_code,
        attempts: row.attempts,
        failed: row.failed,
      })),
      spendToday: spend.map((row) => ({
        providerCode: row.provider_code,
        usd: Number(row.usd),
      })),
    };
  };
}

/**
 * One check: read, assess, and when anything is found, one `alert` line
 * plus one operator alert per finding. Returns the findings for tests.
 */
export async function checkOps(input: {
  readonly read: ReturnType<typeof createPostgresOpsReader>;
  readonly dbTimeoutsSinceLastCheck: number;
  readonly dbPoolExhaustionsSinceLastCheck?: number | undefined;
  readonly thresholds: OpsThresholds;
  readonly dailyCapUsd: number | undefined;
  readonly alert: (alert: OperatorAlert) => Promise<boolean>;
  readonly now: Date;
  readonly logger: RunnerLogger;
}): Promise<readonly OpsFinding[]> {
  const reading = await input.read({
    now: input.now,
    thresholds: input.thresholds,
  });
  const findings = assessOps({
    reading,
    dbTimeoutsSinceLastCheck: input.dbTimeoutsSinceLastCheck,
    dbPoolExhaustionsSinceLastCheck: input.dbPoolExhaustionsSinceLastCheck,
    thresholds: input.thresholds,
    dailyCapUsd: input.dailyCapUsd,
  });
  if (findings.length === 0) return findings;
  input.logger.error(
    {
      alert: OPS_CHECK_ALERT,
      findings: findings.map((finding) => finding.code),
      ...findings.reduce<Record<string, unknown>>(
        (fields, finding) => ({ ...fields, ...finding.fields }),
        {},
      ),
    },
    `operational check: ${findings.map((finding) => finding.code).join(", ")}`,
  );
  for (const finding of findings) {
    try {
      await input.alert({
        key: finding.key,
        subject: finding.subject,
        text: finding.text,
      });
    } catch (error: unknown) {
      input.logger.warn(
        { err: error, alertKey: finding.key },
        "operational check: operator alert could not be sent",
      );
    }
  }
  return findings;
}

export async function runOpsWatch(options: {
  readonly read: ReturnType<typeof createPostgresOpsReader>;
  /** Monotonic count of this process's 57014 statements. */
  readonly dbTimeouts: () => number;
  /** Monotonic count of this process's pool exhaustions; absent: none. */
  readonly dbPoolExhaustions?: (() => number) | undefined;
  readonly thresholds: OpsThresholds;
  readonly dailyCapUsd: number | undefined;
  readonly alert: (alert: OperatorAlert) => Promise<boolean>;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly now?: (() => Date) | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  /**
   * The console's System health: told after every check, the finding codes
   * or CHECK_FAILED. A failure to record it is logged, never fatal.
   */
  readonly heartbeat?: Heartbeat | undefined;
  /**
   * W1-B: the services' health checks, probed on every check; their
   * findings go through the same operator channel. Absent: none probed.
   */
  readonly health?:
    | {
        readonly probe: () => Promise<readonly ProbeResult[]>;
        readonly watch: ReturnType<typeof createHealthWatch>;
      }
    | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? (() => new Date());
  // W1-B: the last alert actually sent (not de-duplicated), for the console.
  let lastAlert: LastAlert | null = null;
  const alert = async (one: OperatorAlert): Promise<boolean> => {
    const sent = await options.alert(one);
    if (sent) lastAlert = { subject: one.subject, at: now().toISOString() };
    return sent;
  };
  const exhaustions = options.dbPoolExhaustions ?? (() => 0);
  let timeoutsSeen = options.dbTimeouts();
  let exhaustionsSeen = exhaustions();
  while (!options.signal.aborted) {
    const timeoutsNow = options.dbTimeouts();
    const exhaustionsNow = exhaustions();
    const at = now();
    let findings: readonly string[] = ["CHECK_FAILED"];
    try {
      const found = await checkOps({
        read: options.read,
        dbTimeoutsSinceLastCheck: timeoutsNow - timeoutsSeen,
        dbPoolExhaustionsSinceLastCheck: exhaustionsNow - exhaustionsSeen,
        thresholds: options.thresholds,
        dailyCapUsd: options.dailyCapUsd,
        alert,
        now: at,
        logger: options.logger,
      });
      findings = found.map((finding) => finding.code);
      timeoutsSeen = timeoutsNow;
      exhaustionsSeen = exhaustionsNow;
    } catch (error: unknown) {
      // The check failing is itself worth an alert line: an unreadable
      // database is exactly when the owner needs to look. The process's
      // own counts still go out, since they need no read.
      options.logger.error(
        {
          alert: OPS_CHECK_ALERT,
          findings: ["CHECK_FAILED"],
          err: error,
          dbTimeouts: timeoutsNow - timeoutsSeen,
          dbPoolExhaustions: exhaustionsNow - exhaustionsSeen,
        },
        "operational check could not read the database",
      );
    }
    // W1-B: the services' health, beside the database check (a failure to
    // probe is a finding of its own kind, never a crash of the loop).
    if (options.health !== undefined) {
      try {
        const results = await options.health.probe();
        const healthFindings = options.health.watch.assess(results);
        if (healthFindings.length > 0) {
          options.logger.error(
            {
              alert: OPS_CHECK_ALERT,
              findings: healthFindings.map((finding) => finding.code),
              ...healthFindings.reduce<Record<string, unknown>>(
                (fields, finding) => ({ ...fields, ...finding.fields }),
                {},
              ),
            },
            `operational check: ${healthFindings.map((finding) => finding.code).join(", ")}`,
          );
        }
        for (const finding of healthFindings) {
          await alert({
            key: finding.key,
            subject: finding.subject,
            text: finding.text,
          }).catch((error: unknown) => {
            options.logger.warn(
              { err: error, alertKey: finding.key },
              "operational check: operator alert could not be sent",
            );
            return false;
          });
        }
        findings = [...findings, ...healthFindings.map((f) => f.code)];
      } catch (error: unknown) {
        options.logger.warn(
          { err: error },
          "operational check: the services' health could not be probed",
        );
      }
    }
    if (options.heartbeat !== undefined) {
      try {
        await options.heartbeat({
          at,
          findings,
          ...(options.health === undefined
            ? {}
            : { services: options.health.watch.summary() }),
          lastAlert,
        });
      } catch (error: unknown) {
        options.logger.warn(
          { err: error },
          "operational check: the heartbeat could not be recorded",
        );
      }
    }
    await sleep(options.thresholds.intervalMs, options.signal);
  }
}
