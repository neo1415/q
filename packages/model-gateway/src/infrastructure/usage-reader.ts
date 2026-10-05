import type { DatabaseExecutor } from "@capital-q/database";
import {
  MODEL_USAGE_PURPOSES,
  type ModelUsagePurpose,
} from "@capital-q/contracts";

/**
 * What the usage ledger says a month cost (lead 2026-10-03: "This month:
 * Q used about $X for you"; admin cost per tenant and user). Reads only:
 * the ledger stays append-only. Sums are numeric text, never floats. Rows
 * written before the purpose column read their purpose the way the gateway
 * derives it now (an instruction's correlation id, a Q run, else OTHER).
 * Unpriced attempts count as calls with no cost.
 */

const PURPOSE_SQL = (sql: DatabaseExecutor) => sql`
  case when u.purpose <> 'OTHER' then u.purpose
       when u.correlation_id like 'cor\\_instr\\_%' then 'INSTRUCTION'
       when u.q_run_id is not null then 'CONVERSATION'
       else 'OTHER' end`;

/** The month [start, end) an instant is in, in UTC. */
export function monthOf(at: Date): { start: Date; end: Date; label: string } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start, end, label: start.toISOString().slice(0, 7) };
}

export type UsageByPurpose = {
  readonly purpose: ModelUsagePurpose;
  readonly usd: string;
  readonly calls: number;
};

export type OwnMonthUsage = {
  readonly totalUsd: string;
  readonly calls: number;
  /** Successful calls whose cost is not known (no price yet). */
  readonly unpricedCalls: number;
  /** Calls that failed (auth, timeout, outage, cancelled): never charged. */
  readonly failedCalls: number;
  readonly byPurpose: readonly UsageByPurpose[];
  /** Spend under each standing instruction, by its id. */
  readonly byInstruction: readonly {
    readonly instructionId: string;
    readonly usd: string;
    readonly calls: number;
  }[];
};

export type AdminMonthUsage = {
  readonly totalUsd: string;
  readonly tenants: readonly {
    readonly tenantId: string;
    readonly usd: string;
    readonly calls: number;
  }[];
  readonly users: readonly {
    readonly tenantId: string;
    /** Null: calls with no person (a GateQ guest). */
    readonly userId: string | null;
    readonly usd: string;
    readonly calls: number;
  }[];
  /** What costs most: by purpose and task class, then by model. */
  readonly drivers: readonly {
    readonly purpose: ModelUsagePurpose;
    readonly taskClass: string;
    readonly model: string;
    readonly usd: string;
    readonly calls: number;
  }[];
};

const isPurpose = (value: string): value is ModelUsagePurpose =>
  (MODEL_USAGE_PURPOSES as readonly string[]).includes(value);

export type WorkforceCostRow = {
  readonly jobId: string;
  readonly runId: string;
  readonly usd: string;
  readonly calls: number;
};

const WORKFORCE_JOB_SQL = "^cor_job_([0-9a-f-]{36})_";
const WORKFORCE_RUN_SQL = "^cor_job_[0-9a-f-]{36}_([0-9a-f-]{36})";

export function createPostgresUsageReader(sql: DatabaseExecutor) {
  return {
    /** One person's own month, in their tenant. */
    ownMonth: async (
      who: { readonly userId: string; readonly tenantId: string },
      at: Date,
    ): Promise<OwnMonthUsage> => {
      const { start, end } = monthOf(at);
      const rows = await sql<
        {
          purpose: string;
          instruction_id: string | null;
          usd: string;
          calls: number;
          unpriced: number;
          failed: number;
        }[]
      >`
        select ${PURPOSE_SQL(sql)} as purpose,
               substring(u.correlation_id from '^cor_instr_([0-9a-f-]{36})_') as instruction_id,
               round(coalesce(sum(u.cost_usd), 0), 6)::text as usd,
               count(*)::int as calls,
               -- A failed call has no cost and is not charged; it is not a
               -- call "without a price yet" (QA 2026-10-03: 130 such rows).
               count(*) filter (where u.cost_usd is null and u.success)::int as unpriced,
               count(*) filter (where not u.success)::int as failed
          from ai_ops.model_usage u
         where u.user_id = ${who.userId} and u.tenant_id = ${who.tenantId}
           and u.occurred_at >= ${start} and u.occurred_at < ${end}
         group by 1, 2`;
      const byPurpose = new Map<
        ModelUsagePurpose,
        { usd: number; calls: number }
      >();
      const byInstruction = new Map<string, { usd: number; calls: number }>();
      let total = 0;
      let calls = 0;
      let unpriced = 0;
      let failed = 0;
      for (const row of rows) {
        // Summed in micro-dollars: the ledger's numeric, never a float sum.
        const micros = Math.round(Number(row.usd) * 1_000_000);
        total += micros;
        calls += row.calls;
        unpriced += row.unpriced;
        failed += row.failed;
        const purpose = isPurpose(row.purpose) ? row.purpose : "OTHER";
        const bucket = byPurpose.get(purpose) ?? { usd: 0, calls: 0 };
        byPurpose.set(purpose, {
          usd: bucket.usd + micros,
          calls: bucket.calls + row.calls,
        });
        if (row.instruction_id !== null) {
          const own = byInstruction.get(row.instruction_id) ?? {
            usd: 0,
            calls: 0,
          };
          byInstruction.set(row.instruction_id, {
            usd: own.usd + micros,
            calls: own.calls + row.calls,
          });
        }
      }
      const dollars = (micros: number) => (micros / 1_000_000).toFixed(6);
      return {
        totalUsd: dollars(total),
        calls,
        unpricedCalls: unpriced,
        failedCalls: failed,
        byPurpose: [...byPurpose.entries()]
          .map(([purpose, v]) => ({
            purpose,
            usd: dollars(v.usd),
            calls: v.calls,
          }))
          .sort((a, b) => Number(b.usd) - Number(a.usd)),
        byInstruction: [...byInstruction.entries()]
          .map(([instructionId, v]) => ({
            instructionId,
            usd: dollars(v.usd),
            calls: v.calls,
          }))
          .sort((a, b) => Number(b.usd) - Number(a.usd)),
      };
    },

    /**
     * Founder brief J6: what Q's workforce agents spent on the person's
     * jobs, by job and by agent run, read from the same ledger. A workforce
     * call carries `cor_job_<job id>_<agent run id>` (see
     * `workforceCorrelationId`); only the person's own rows are read.
     */
    workforceCosts: async (
      who: { readonly userId: string; readonly tenantId: string },
      jobIds: readonly string[],
    ): Promise<readonly WorkforceCostRow[]> => {
      if (jobIds.length === 0) return [];
      const rows = await sql<
        { job_id: string; run_id: string; usd: string; calls: number }[]
      >`
        select substring(u.correlation_id from ${WORKFORCE_JOB_SQL}) as job_id,
               substring(u.correlation_id from ${WORKFORCE_RUN_SQL}) as run_id,
               round(coalesce(sum(u.cost_usd), 0), 6)::text as usd,
               count(*)::int as calls
          from ai_ops.model_usage u
         where u.user_id = ${who.userId} and u.tenant_id = ${who.tenantId}
           and u.correlation_id like 'cor\_job\_%'
           and substring(u.correlation_id from ${WORKFORCE_JOB_SQL}) = any(${[...jobIds]}::text[])
         group by 1, 2`;
      return rows.map((row) => ({
        jobId: row.job_id,
        runId: row.run_id,
        usd: row.usd,
        calls: row.calls,
      }));
    },

    /** The whole platform's month, for the platform admin only. */
    adminMonth: async (at: Date, limit = 20): Promise<AdminMonthUsage> => {
      const { start, end } = monthOf(at);
      const [total, tenants, users, drivers] = await Promise.all([
        sql<{ usd: string }[]>`
          select round(coalesce(sum(cost_usd), 0), 6)::text as usd from ai_ops.model_usage
           where occurred_at >= ${start} and occurred_at < ${end}`,
        sql<{ tenant_id: string; usd: string; calls: number }[]>`
          select tenant_id, round(coalesce(sum(cost_usd), 0), 6)::text as usd, count(*)::int as calls
            from ai_ops.model_usage
           where occurred_at >= ${start} and occurred_at < ${end}
           group by tenant_id order by sum(cost_usd) desc nulls last limit ${limit}`,
        sql<
          {
            tenant_id: string;
            user_id: string | null;
            usd: string;
            calls: number;
          }[]
        >`
          select tenant_id, user_id, round(coalesce(sum(cost_usd), 0), 6)::text as usd, count(*)::int as calls
            from ai_ops.model_usage
           where occurred_at >= ${start} and occurred_at < ${end}
           group by tenant_id, user_id order by sum(cost_usd) desc nulls last limit ${limit}`,
        sql<
          {
            purpose: string;
            task_class: string;
            model: string;
            usd: string;
            calls: number;
          }[]
        >`
          select ${PURPOSE_SQL(sql)} as purpose, u.task_class, m.model_code as model,
                 round(coalesce(sum(u.cost_usd), 0), 6)::text as usd, count(*)::int as calls
            from ai_ops.model_usage u
            join ai_ops.models m on m.id = u.model_id
           where u.occurred_at >= ${start} and u.occurred_at < ${end}
           group by 1, 2, 3 order by sum(u.cost_usd) desc nulls last limit ${limit}`,
      ]);
      return {
        totalUsd: total[0]?.usd ?? "0",
        tenants: tenants.map((row) => ({
          tenantId: row.tenant_id,
          usd: row.usd,
          calls: row.calls,
        })),
        users: users.map((row) => ({
          tenantId: row.tenant_id,
          userId: row.user_id,
          usd: row.usd,
          calls: row.calls,
        })),
        drivers: drivers.map((row) => ({
          purpose: isPurpose(row.purpose) ? row.purpose : "OTHER",
          taskClass: row.task_class,
          model: row.model,
          usd: row.usd,
          calls: row.calls,
        })),
      };
    },
  };
}

export type UsageReader = ReturnType<typeof createPostgresUsageReader>;
