import {
  Q_TEAM_THREAD_READ_MAX_CHARS,
  Q_TEAM_THREAD_READ_MAX_ENTRIES,
  QPlanSchema,
  QTeamThreadAppendSchema,
  type QPlan,
  type QPlanStatus,
  type QSituationDossier,
  type QSituationSide,
  type QTeamThreadAppend,
  type QTeamThreadEntry,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import type { Owner } from "./store.js";

/**
 * Situation-first planning (S4-S6): the record of a person's plans, their
 * versions and the team thread (`q_runtime.q_plans`, `q_plan_versions`,
 * `workforce_thread`, migration 20261231150000).
 *
 * Every statement names the owner (tenant and user): someone else's plan
 * is the same "not found" as none. Versions are append-only and in order
 * (the migration's triggers hold that); a retried write writes nothing
 * (idempotency keys). Each call is one round trip, two for a version (the
 * version and the plan's status in one short transaction).
 */

export type PlanHead = {
  readonly planId: string;
  readonly currentVersion: number;
  readonly status: QPlanStatus;
  readonly side: QSituationSide;
  readonly goal: string;
  readonly jobId: string | null;
};

export type StoredPlanVersion = {
  readonly plan: QPlan;
  readonly bodySha256: string;
  readonly headVersion: number;
  readonly status: QPlanStatus;
  readonly situation: unknown;
  readonly createdAt: string;
};

export type NewPlanVersion = {
  readonly planId: string;
  readonly plan: QPlan;
  readonly bodySha256: string;
  readonly situation: QSituationDossier;
  readonly threshold: number;
  readonly rubricVersion: string;
  readonly promptVersion: string;
  readonly scoreR1: number | null;
  readonly scoreR2: number | null;
  readonly fullyReviewed: boolean;
  readonly redrafts: number;
  readonly cause: "DRAFT" | "CHANGE" | "UPLOAD" | "REPLAN";
  readonly directionId: string | null;
  /** The plan's status once this version is its head. */
  readonly status: QPlanStatus;
};

/** A plan under way, for the condition sweep (S6). */
export type LivePlanRow = {
  readonly planId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly version: number;
  readonly body: unknown;
};

export type PlanStore = {
  /** The plan for this key (one per key), created when new. */
  readonly ensurePlan: (
    owner: Owner,
    input: {
      readonly side: QSituationSide;
      readonly goal: string;
      readonly jobId: string | null;
      readonly idempotencyKey: string;
    },
  ) => Promise<PlanHead>;
  readonly head: (owner: Owner, planId: string) => Promise<PlanHead | null>;
  /** False: that version already exists (a retried write). */
  readonly addVersion: (
    owner: Owner,
    input: NewPlanVersion,
  ) => Promise<boolean>;
  readonly setStatus: (
    owner: Owner,
    planId: string,
    status: QPlanStatus,
  ) => Promise<void>;
  /** A version (the head when absent), as stored. */
  readonly read: (
    owner: Owner,
    planId: string,
    version?: number,
  ) => Promise<StoredPlanVersion | null>;
  /** Appends one entry; a retried append returns the entry already written. */
  readonly appendThread: (
    owner: Owner,
    entry: QTeamThreadAppend,
  ) => Promise<QTeamThreadEntry | null>;
  /**
   * The latest entries of a plan's (or a job's) thread, oldest first,
   * bounded by count and characters (what an executor reads before its
   * next action).
   */
  readonly readThread: (
    owner: Owner,
    of: { readonly planId: string } | { readonly jobId: string },
    bounds?: {
      readonly kinds?: readonly QTeamThreadEntry["kind"][] | undefined;
      readonly afterSeq?: number | undefined;
      /**
       * The orchestrator's own projection (step states): up to 300 entries,
       * not cut to an executor's reading bound.
       */
      readonly all?: boolean | undefined;
    },
  ) => Promise<readonly QTeamThreadEntry[]>;
  /** The tenant's plans under way (ACCEPTED, ON_BOARD, EXECUTING), head bodies. */
  readonly livePlans: (tenantId: string) => Promise<readonly LivePlanRow[]>;
};

/** A plain JSON value for a jsonb parameter. */
function asJson(value: unknown): Parameters<DatabaseExecutor["json"]>[0] {
  return JSON.parse(JSON.stringify(value)) as Parameters<
    DatabaseExecutor["json"]
  >[0];
}

type HeadRow = {
  readonly id: string;
  readonly current_version: number;
  readonly status: QPlanStatus;
  readonly side: QSituationSide;
  readonly goal: string;
  readonly job_id: string | null;
};

const headOf = (row: HeadRow): PlanHead => ({
  planId: row.id,
  currentVersion: row.current_version,
  status: row.status,
  side: row.side,
  goal: row.goal,
  jobId: row.job_id,
});

type ThreadRow = {
  readonly id: string;
  readonly plan_id: string | null;
  readonly job_id: string | null;
  readonly seq: number;
  readonly kind: QTeamThreadEntry["kind"];
  readonly author: QTeamThreadEntry["author"];
  readonly step_key: string | null;
  readonly fact_ref: string | null;
  readonly body: string;
  readonly created_at: Date;
};

const entryOf = (row: ThreadRow): QTeamThreadEntry => ({
  id: row.id,
  planId: row.plan_id as QTeamThreadEntry["planId"],
  jobId: row.job_id,
  kind: row.kind,
  author: row.author,
  stepKey: row.step_key,
  factRef: row.fact_ref,
  text: row.body,
  seq: row.seq,
  createdAt: row.created_at.toISOString(),
});

/**
 * The newest entries first from the store, kept within the read bound
 * (entries and characters), then returned oldest first.
 */
export function boundThread(
  newestFirst: readonly QTeamThreadEntry[],
  maxEntries = Q_TEAM_THREAD_READ_MAX_ENTRIES,
  maxChars = Q_TEAM_THREAD_READ_MAX_CHARS,
): readonly QTeamThreadEntry[] {
  const kept: QTeamThreadEntry[] = [];
  let chars = 0;
  for (const entry of newestFirst) {
    if (kept.length >= maxEntries) break;
    if (chars + entry.text.length > maxChars) break;
    chars += entry.text.length;
    kept.push(entry);
  }
  return kept.reverse();
}

export function createPostgresPlanStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): PlanStore {
  const { sql, transactions } = dependencies;
  return {
    ensurePlan: async (owner, input) => {
      // One round trip: a retried key returns the plan already filed (the
      // no-op update keeps the row as it is; the guard trigger allows it).
      const rows = await sql<HeadRow[]>`
        insert into q_runtime.q_plans (tenant_id, user_id, side, goal, job_id, idempotency_key)
        values (${owner.tenantId}, ${owner.userId}, ${input.side},
                ${input.goal.trim().slice(0, 500)}, ${input.jobId}, ${input.idempotencyKey})
        on conflict (tenant_id, user_id, idempotency_key)
          do update set status = q_runtime.q_plans.status
        returning id, current_version, status, side, goal, job_id`;
      const row = rows[0];
      if (row === undefined) throw new Error("the plan was not filed");
      return headOf(row);
    },

    head: async (owner, planId) => {
      const rows = await sql<HeadRow[]>`
        select id, current_version, status, side, goal, job_id
          from q_runtime.q_plans
         where id = ${planId} and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}`;
      const row = rows[0];
      return row === undefined ? null : headOf(row);
    },

    addVersion: async (owner, input) => {
      const body = QPlanSchema.parse(input.plan);
      return transactions.run(async (tx) => {
        const inserted = await tx.sql<{ id: string }[]>`
          insert into q_runtime.q_plan_versions (
            plan_id, tenant_id, user_id, version, body, body_sha256, situation,
            review_threshold, rubric_version, prompt_version, score_r1, score_r2,
            fully_reviewed, redrafts, cause, direction_id)
          select p.id, p.tenant_id, p.user_id, ${body.version},
                 ${sql.json(asJson(body))}, ${input.bodySha256},
                 ${sql.json(asJson(input.situation))},
                 ${input.threshold}, ${input.rubricVersion}, ${input.promptVersion},
                 ${input.scoreR1}, ${input.scoreR2}, ${input.fullyReviewed},
                 ${input.redrafts}, ${input.cause}, ${input.directionId}
            from q_runtime.q_plans p
           where p.id = ${input.planId} and p.tenant_id = ${owner.tenantId}
             and p.user_id = ${owner.userId}
          on conflict (plan_id, version) do nothing
          returning id`;
        if (inserted.length === 0) return false;
        await tx.sql`
          update q_runtime.q_plans set status = ${input.status}
           where id = ${input.planId} and tenant_id = ${owner.tenantId}
             and user_id = ${owner.userId}`;
        return true;
      });
    },

    setStatus: async (owner, planId, status) => {
      await sql`
        update q_runtime.q_plans set status = ${status}
         where id = ${planId} and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}`;
    },

    read: async (owner, planId, version) => {
      const rows = await sql<
        {
          readonly body: unknown;
          readonly body_sha256: string;
          readonly current_version: number;
          readonly status: QPlanStatus;
          readonly situation: unknown;
          readonly created_at: Date;
        }[]
      >`
        select v.body, v.body_sha256, p.current_version, p.status, v.situation, v.created_at
          from q_runtime.q_plans p
          join q_runtime.q_plan_versions v
            on v.plan_id = p.id and v.version = coalesce(${version ?? null}::int, p.current_version)
         where p.id = ${planId} and p.tenant_id = ${owner.tenantId} and p.user_id = ${owner.userId}`;
      const row = rows[0];
      if (row === undefined) return null;
      // Stored jsonb is re-validated: what the server wrote, read as data.
      const plan = QPlanSchema.safeParse(row.body);
      if (!plan.success) return null;
      return {
        plan: plan.data,
        bodySha256: row.body_sha256,
        headVersion: row.current_version,
        status: row.status,
        situation: row.situation,
        createdAt: row.created_at.toISOString(),
      };
    },

    appendThread: async (owner, entry) => {
      const parsed = QTeamThreadAppendSchema.parse(entry);
      const insert = () =>
        sql<ThreadRow[]>`
          with existing as (
            select * from q_runtime.workforce_thread
             where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
               and idempotency_key = ${parsed.idempotencyKey}
          ), inserted as (
            insert into q_runtime.workforce_thread (
              tenant_id, user_id, plan_id, job_id, seq, kind, author, step_key,
              fact_ref, body, idempotency_key)
            select ${owner.tenantId}, ${owner.userId}, ${parsed.planId}, ${parsed.jobId},
                   coalesce((
                     select max(t.seq) from q_runtime.workforce_thread t
                      where (${parsed.planId}::uuid is not null and t.plan_id = ${parsed.planId}::uuid)
                         or (${parsed.planId}::uuid is null and t.plan_id is null
                             and t.job_id = ${parsed.jobId}::uuid)), 0) + 1,
                   ${parsed.kind}, ${parsed.author}, ${parsed.stepKey}, ${parsed.factRef},
                   ${parsed.text}, ${parsed.idempotencyKey}
             where not exists (select 1 from existing)
            on conflict (tenant_id, user_id, idempotency_key) do nothing
            returning *)
          select id, plan_id, job_id, seq, kind, author, step_key, fact_ref, body, created_at
            from inserted
          union all
          select id, plan_id, job_id, seq, kind, author, step_key, fact_ref, body, created_at
            from existing`;
      let rows: readonly ThreadRow[];
      try {
        rows = await insert();
      } catch {
        // Two appends raced for the same position: the next one is free.
        rows = await insert();
      }
      const row = rows[0];
      return row === undefined ? null : entryOf(row);
    },

    readThread: async (owner, of, bounds) => {
      const planId = "planId" in of ? of.planId : null;
      const jobId = "jobId" in of ? of.jobId : null;
      const kinds = bounds?.kinds === undefined ? null : [...bounds.kinds];
      const rows = await sql<ThreadRow[]>`
        select id, plan_id, job_id, seq, kind, author, step_key, fact_ref, body, created_at
          from q_runtime.workforce_thread
         where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
           and ((${planId}::uuid is not null and plan_id = ${planId}::uuid)
             or (${planId}::uuid is null and job_id = ${jobId}::uuid))
           and (${kinds}::text[] is null or kind = any(${kinds}::text[]))
           and seq > ${bounds?.afterSeq ?? 0}
         order by seq desc
         limit ${bounds?.all === true ? 300 : Q_TEAM_THREAD_READ_MAX_ENTRIES}`;
      const entries = rows.map(entryOf);
      return bounds?.all === true ? entries.reverse() : boundThread(entries);
    },

    livePlans: async (tenantId) => {
      const rows = await sql<
        {
          readonly id: string;
          readonly tenant_id: string;
          readonly user_id: string;
          readonly version: number;
          readonly body: unknown;
        }[]
      >`
        select p.id, p.tenant_id, p.user_id, v.version, v.body
          from q_runtime.q_plans p
          join q_runtime.q_plan_versions v
            on v.plan_id = p.id and v.version = p.current_version
         where p.tenant_id = ${tenantId}
           and p.status in ('ACCEPTED', 'ON_BOARD', 'EXECUTING')
         order by p.updated_at desc
         limit 50`;
      return rows.map((row) => ({
        planId: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        version: row.version,
        body: row.body,
      }));
    },
  };
}
