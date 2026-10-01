import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import type { AdminGrant } from "./access.js";
import { activeBreakGlass, logBreakGlassRead } from "./break-glass.js";

/**
 * Q monitoring (spec §4): runs, refusals, failures, latency and cost from
 * the records Q already keeps -- `q_runtime.runs/run_events`,
 * `ai_ops.model_usage` (no prompt, no response) and the firewall decision
 * log (codes only). A run's words stay redacted unless the caller holds a
 * live break-glass for that run.
 */

export const MONITOR_WINDOWS = ["24h", "7d", "30d"] as const;
export type MonitorWindow = (typeof MONITOR_WINDOWS)[number];

const INTERVAL: Readonly<Record<MonitorWindow, string>> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export type QMonitor = {
  readonly window: MonitorWindow;
  readonly runsByStatus: readonly {
    readonly status: string;
    readonly runs: number;
  }[];
  readonly runFailures: readonly {
    readonly code: string;
    readonly runs: number;
  }[];
  readonly refusals: {
    readonly firewallDenied: number;
    readonly firewallAuthorised: number;
    readonly policyDeniedRuns: number;
    readonly byReason: readonly {
      readonly reason: string;
      readonly count: number;
    }[];
  };
  readonly calls: {
    readonly total: number;
    readonly failed: number;
    readonly costUsd: string;
    readonly unpriced: number;
  };
  readonly callFailures: readonly {
    readonly code: string;
    readonly calls: number;
  }[];
  readonly latency: readonly {
    readonly taskClass: string;
    readonly model: string;
    readonly calls: number;
    readonly failed: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly costUsd: string;
  }[];
  readonly costPerDay: readonly {
    readonly day: string;
    readonly costUsd: string;
    readonly calls: number;
  }[];
  readonly recentRuns: readonly {
    readonly runId: string;
    readonly capability: string;
    readonly status: string;
    readonly failureCode: string | null;
    readonly userName: string | null;
    readonly createdAt: string;
    readonly durationMs: number | null;
  }[];
};

export function isMonitorWindow(value: unknown): value is MonitorWindow {
  return (
    typeof value === "string" &&
    (MONITOR_WINDOWS as readonly string[]).includes(value)
  );
}

export async function qMonitor(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  window: MonitorWindow,
): Promise<QMonitor> {
  const since = INTERVAL[window];
  const [
    runsByStatus,
    runFailures,
    firewall,
    calls,
    callFailures,
    latency,
    cost,
    recent,
  ] = await Promise.all([
    sql<{ status: string; runs: number }[]>`
        select status, count(*)::int as runs from q_runtime.runs
         where created_at > now() - ${since}::interval
         group by status order by runs desc`,
    sql<{ code: string; runs: number }[]>`
        select failure_code as code, count(*)::int as runs from q_runtime.runs
         where created_at > now() - ${since}::interval and failure_code is not null
         group by failure_code order by runs desc`,
    sql<{ outcome: string; reason: string | null; n: number }[]>`
        select outcome, reason, count(*)::int as n from platform_ops.q_firewall_decisions
         where occurred_at > now() - ${since}::interval
         group by outcome, reason`,
    sql<{ total: number; failed: number; cost: string; unpriced: number }[]>`
        select count(*)::int as total,
               (count(*) filter (where not success))::int as failed,
               coalesce(sum(cost_usd), 0)::text as cost,
               (count(*) filter (where cost_basis = 'UNPRICED'))::int as unpriced
          from ai_ops.model_usage
         where occurred_at > now() - ${since}::interval`,
    sql<{ code: string; calls: number }[]>`
        select error_code as code, count(*)::int as calls from ai_ops.model_usage
         where occurred_at > now() - ${since}::interval and not success
         group by error_code order by calls desc`,
    sql<
      {
        task_class: string;
        model: string;
        calls: number;
        failed: number;
        p50: number | null;
        p95: number | null;
        cost: string;
      }[]
    >`
        select u.task_class, m.model_code as model, count(*)::int as calls,
               (count(*) filter (where not u.success))::int as failed,
               percentile_cont(0.5) within group (order by u.latency_ms) as p50,
               percentile_cont(0.95) within group (order by u.latency_ms) as p95,
               coalesce(sum(u.cost_usd), 0)::text as cost
          from ai_ops.model_usage u
          join ai_ops.models m on m.id = u.model_id
         where u.occurred_at > now() - ${since}::interval
         group by u.task_class, m.model_code
         order by calls desc`,
    sql<{ day: Date; cost: string; calls: number }[]>`
        select date_trunc('day', occurred_at) as day,
               coalesce(sum(cost_usd), 0)::text as cost, count(*)::int as calls
          from ai_ops.model_usage
         where occurred_at > now() - ${since}::interval
         group by 1 order by 1`,
    sql<
      {
        id: string;
        capability: string;
        status: string;
        failure_code: string | null;
        user_name: string | null;
        created_at: Date;
        duration_ms: number | null;
      }[]
    >`
        select r.id, r.capability, r.status, r.failure_code, p.display_name as user_name,
               r.created_at,
               case when r.completed_at is null then null
                    else (extract(epoch from (r.completed_at - r.created_at)) * 1000)::int end as duration_ms
          from q_runtime.runs r
          left join identity.user_profiles p on p.id = r.actor_user_id
         where r.created_at > now() - ${since}::interval
         order by r.created_at desc
         limit 50`,
  ]);
  const total = calls[0];
  const count = (outcome: string) =>
    firewall
      .filter((row) => row.outcome === outcome)
      .reduce((sum, row) => sum + row.n, 0);
  return {
    window,
    runsByStatus,
    runFailures,
    refusals: {
      firewallDenied: count("DENIED"),
      firewallAuthorised: count("AUTHORISED"),
      policyDeniedRuns:
        runFailures.find((row) => row.code === "POLICY_DENIED")?.runs ?? 0,
      byReason: firewall
        .filter((row) => row.outcome === "DENIED")
        .map((row) => ({ reason: row.reason ?? "UNSTATED", count: row.n }))
        .sort((a, b) => b.count - a.count),
    },
    calls: {
      total: total?.total ?? 0,
      failed: total?.failed ?? 0,
      costUsd: total?.cost ?? "0",
      unpriced: total?.unpriced ?? 0,
    },
    callFailures,
    latency: latency.map((row) => ({
      taskClass: row.task_class,
      model: row.model,
      calls: row.calls,
      failed: row.failed,
      p50Ms: Math.round(row.p50 ?? 0),
      p95Ms: Math.round(row.p95 ?? 0),
      costUsd: row.cost,
    })),
    costPerDay: cost.map((row) => ({
      day: new Date(row.day).toISOString().slice(0, 10),
      costUsd: row.cost,
      calls: row.calls,
    })),
    recentRuns: recent.map((row) => ({
      runId: row.id,
      capability: row.capability,
      status: row.status,
      failureCode: row.failure_code,
      userName: row.user_name,
      createdAt: new Date(row.created_at).toISOString(),
      durationMs: row.duration_ms,
    })),
  };
}

export type QErrorItem = {
  readonly kind: "MODEL_CALL" | "RUN";
  readonly at: string;
  readonly code: string;
  readonly taskClass: string | null;
  readonly model: string | null;
  readonly latencyMs: number | null;
  readonly runId: string | null;
  readonly correlationId: string | null;
};

/** The latest failures, newest first: the live error stream. */
export async function qErrors(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  limit = 50,
): Promise<readonly QErrorItem[]> {
  const bounded = Math.max(1, Math.min(limit, 100));
  const [calls, runs] = await Promise.all([
    sql<
      {
        occurred_at: Date;
        error_code: string;
        task_class: string;
        model: string;
        latency_ms: number;
        q_run_id: string | null;
        correlation_id: string | null;
      }[]
    >`
      select u.occurred_at, u.error_code, u.task_class, m.model_code as model,
             u.latency_ms, u.q_run_id, u.correlation_id
        from ai_ops.model_usage u
        join ai_ops.models m on m.id = u.model_id
       where not u.success
       order by u.occurred_at desc
       limit ${bounded}`,
    sql<
      {
        id: string;
        completed_at: Date;
        failure_code: string;
        capability: string;
        correlation_id: string;
      }[]
    >`
      select id, completed_at, failure_code, capability, correlation_id
        from q_runtime.runs
       where status = 'FAILED'
       order by completed_at desc
       limit ${bounded}`,
  ]);
  const items: QErrorItem[] = [
    ...calls.map((row) => ({
      kind: "MODEL_CALL" as const,
      at: new Date(row.occurred_at).toISOString(),
      code: row.error_code,
      taskClass: row.task_class,
      model: row.model,
      latencyMs: row.latency_ms,
      runId: row.q_run_id,
      correlationId: row.correlation_id,
    })),
    ...runs.map((row) => ({
      kind: "RUN" as const,
      at: new Date(row.completed_at).toISOString(),
      code: row.failure_code,
      taskClass: row.capability,
      model: null,
      latencyMs: null,
      runId: row.id,
      correlationId: row.correlation_id,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, bounded);
}

export type QRunTrace = {
  readonly run: {
    readonly runId: string;
    readonly capability: string;
    readonly consequenceClass: string;
    readonly status: string;
    readonly failureCode: string | null;
    readonly userName: string | null;
    readonly correlationId: string;
    readonly versions: {
      readonly orchestration: string | null;
      readonly promptBundle: string | null;
      readonly modelPolicy: string | null;
    };
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    /** Redacted (null) unless a live break-glass covers this run. */
    readonly objective: string | null;
  };
  readonly redacted: boolean;
  readonly breakGlass: {
    readonly requestId: string;
    readonly expiresAt: string;
  } | null;
  readonly events: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly stage: string | null;
    readonly payloadKeys: readonly string[];
    /** Present only under break-glass. */
    readonly text: string | null;
    readonly at: string;
  }[];
  readonly calls: readonly {
    readonly taskClass: string;
    readonly model: string;
    readonly attempt: number;
    readonly latencyMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: string | null;
    readonly success: boolean;
    readonly errorCode: string | null;
    readonly at: string;
  }[];
  readonly firewall: readonly {
    readonly outcome: string;
    readonly reason: string | null;
    readonly allowed: readonly string[];
    readonly denied: readonly {
      readonly label: string;
      readonly reason: string;
    }[];
    readonly at: string;
  }[];
};

function deniedOf(value: unknown): { label: string; reason: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { label, reason } = entry as { label?: unknown; reason?: unknown };
    return typeof label === "string" && typeof reason === "string"
      ? [{ label, reason }]
      : [];
  });
}

function textOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  for (const key of ["text", "delta", "content", "message"]) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string") return value.slice(0, 4000);
  }
  return null;
}

export async function qRunTrace(
  transactions: TransactionManager,
  grant: AdminGrant,
  runId: string,
): Promise<QRunTrace | null> {
  return transactions.run(async (tx) => {
    const [run] = await tx.sql<
      {
        id: string;
        capability: string;
        consequence_class: string;
        status: string;
        failure_code: string | null;
        user_name: string | null;
        correlation_id: string;
        orchestration_version: string | null;
        prompt_bundle_version: string | null;
        model_policy_version: string | null;
        created_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        objective: string;
      }[]
    >`
      select r.id, r.capability, r.consequence_class, r.status, r.failure_code,
             p.display_name as user_name, r.correlation_id, r.orchestration_version,
             r.prompt_bundle_version, r.model_policy_version, r.created_at,
             r.started_at, r.completed_at, r.objective
        from q_runtime.runs r
        left join identity.user_profiles p on p.id = r.actor_user_id
       where r.id = ${runId}`;
    if (run === undefined) return null;
    const glass = await activeBreakGlass(tx.sql, grant.userId, "Q_RUN", runId);
    const [events, calls, firewall] = await Promise.all([
      tx.sql<
        {
          sequence: number;
          event_type: string;
          visible_stage: string | null;
          payload: Record<string, unknown>;
          occurred_at: Date;
        }[]
      >`
        select sequence, event_type, visible_stage, payload, occurred_at
          from q_runtime.run_events where run_id = ${runId}
         order by sequence limit 500`,
      tx.sql<
        {
          task_class: string;
          model: string;
          attempt: number;
          latency_ms: number;
          input_tokens: number;
          output_tokens: number;
          cost_usd: string | null;
          success: boolean;
          error_code: string | null;
          occurred_at: Date;
        }[]
      >`
        select u.task_class, m.model_code as model, u.attempt, u.latency_ms,
               u.input_tokens, u.output_tokens, u.cost_usd::text as cost_usd,
               u.success, u.error_code, u.occurred_at
          from ai_ops.model_usage u
          join ai_ops.models m on m.id = u.model_id
         where u.q_run_id = ${runId} or u.correlation_id = ${run.correlation_id}
         order by u.occurred_at limit 200`,
      tx.sql<
        {
          outcome: string;
          reason: string | null;
          allowed_labels: string[];
          denied: unknown;
          occurred_at: Date;
        }[]
      >`
        select outcome, reason, allowed_labels, denied, occurred_at
          from platform_ops.q_firewall_decisions
         where run_id = ${runId}
         order by occurred_at limit 50`,
    ]);
    if (glass !== null) {
      await logBreakGlassRead(
        tx.sql,
        grant,
        glass.requestId,
        events.length + 1,
        "breakglass.q_run.read",
      );
    }
    const reveal = glass !== null;
    return {
      run: {
        runId: run.id,
        capability: run.capability,
        consequenceClass: run.consequence_class,
        status: run.status,
        failureCode: run.failure_code,
        userName: run.user_name,
        correlationId: run.correlation_id,
        versions: {
          orchestration: run.orchestration_version,
          promptBundle: run.prompt_bundle_version,
          modelPolicy: run.model_policy_version,
        },
        createdAt: new Date(run.created_at).toISOString(),
        startedAt:
          run.started_at === null
            ? null
            : new Date(run.started_at).toISOString(),
        completedAt:
          run.completed_at === null
            ? null
            : new Date(run.completed_at).toISOString(),
        objective: reveal ? run.objective : null,
      },
      redacted: !reveal,
      breakGlass: glass,
      events: events.map((event) => ({
        sequence: event.sequence,
        type: event.event_type,
        stage: event.visible_stage,
        payloadKeys: Object.keys(event.payload ?? {}).slice(0, 20),
        text: reveal ? textOf(event.payload) : null,
        at: new Date(event.occurred_at).toISOString(),
      })),
      calls: calls.map((call) => ({
        taskClass: call.task_class,
        model: call.model,
        attempt: call.attempt,
        latencyMs: call.latency_ms,
        inputTokens: call.input_tokens,
        outputTokens: call.output_tokens,
        costUsd: call.cost_usd,
        success: call.success,
        errorCode: call.error_code,
        at: new Date(call.occurred_at).toISOString(),
      })),
      firewall: firewall.map((row) => ({
        outcome: row.outcome,
        reason: row.reason,
        allowed: row.allowed_labels,
        denied: deniedOf(row.denied),
        at: new Date(row.occurred_at).toISOString(),
      })),
    };
  });
}
