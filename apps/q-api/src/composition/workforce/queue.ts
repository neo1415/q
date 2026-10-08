import type { QWorkState } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { StepResult } from "@capital-q/q-orchestrator";

import type { WorkforceJobPort } from "@capital-q/app-actions";

import type { Owner, WorkforceStore } from "./store.js";

/**
 * Durable agent work (recovery D3, audit D-08): `q_runtime.agent_work_queue`.
 *
 * An approved job is enqueued, never run inside the approval. A worker
 * claims live rows with `FOR UPDATE SKIP LOCKED` under a lease
 * (`locked_until`) it renews while it works (heartbeat); a row whose lease
 * lapsed -- the worker died, the deploy rolled -- is reclaimed and resumed,
 * and each finished step's result is kept here so a resumed job never
 * redoes one. Every row ends in a terminal work state: COMPLETED, FAILED,
 * CANCELLED, or NEEDS_DECISION / BLOCKED when what is left is the person's.
 *
 * Every statement names the row's owner or its worker: a worker can only
 * renew, record on or finish a row it holds.
 */

/** Where the work came from: ids only (QTraceContext's, plus the approver's organisation). */
export type WorkTrace = {
  readonly actionId?: string | undefined;
  readonly runId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly organisationId?: string | undefined;
};

export type WorkRow = {
  readonly job_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly state: QWorkState;
  readonly plan: unknown;
  readonly trace: WorkTrace;
  readonly results: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly finished_at: Date | null;
};

/** States a run ends in. QUEUED, RUNNING and RECOVERING are live. */
export type EndState = Extract<
  QWorkState,
  "COMPLETED" | "FAILED" | "CANCELLED" | "NEEDS_DECISION" | "BLOCKED"
>;

export const LIVE_WORK_STATES: readonly QWorkState[] = [
  "QUEUED",
  "RUNNING",
  "RECOVERING",
];

export type AgentWorkQueue = {
  /** Idempotent per job: a replayed approval enqueues nothing new. */
  readonly enqueue: (
    owner: Owner,
    input: {
      readonly jobId: string;
      readonly plan: unknown;
      readonly trace: WorkTrace;
    },
  ) => Promise<void>;
  /**
   * Live rows whose lease is free or lapsed, oldest first, now held by
   * `workerId` until `leaseMs` from now. Each claim counts an attempt.
   */
  readonly claim: (
    workerId: string,
    leaseMs: number,
    limit: number,
  ) => Promise<readonly WorkRow[]>;
  /** Renews the lease; false: the row is no longer this worker's. */
  readonly heartbeat: (
    jobId: string,
    workerId: string,
    leaseMs: number,
  ) => Promise<boolean>;
  /** Keeps a finished step's result on the row this worker holds. */
  readonly recordStep: (
    jobId: string,
    workerId: string,
    stepKey: string,
    result: StepResult,
    runId?: string,
  ) => Promise<void>;
  /** Ends the row this worker holds. False: it was not this worker's. */
  readonly finish: (
    jobId: string,
    workerId: string,
    state: EndState,
    reason: string | null,
  ) => Promise<boolean>;
  /**
   * The row this worker holds goes back to the queue (a step threw): it
   * shows RECOVERING with the reason until the next claim.
   */
  readonly release: (
    jobId: string,
    workerId: string,
    reason: string,
  ) => Promise<void>;
  /**
   * Lapsed leases show RECOVERING (Q restarted mid-job), and live rows
   * out of attempts end FAILED with the reason. Returns the ended rows.
   */
  readonly sweep: (maxAge?: number) => Promise<{
    readonly recovering: number;
    readonly failed: readonly Pick<
      WorkRow,
      "job_id" | "tenant_id" | "user_id"
    >[];
  }>;
  /** "Stop that job": a live row of the person's own ends CANCELLED. */
  readonly cancel: (owner: Owner, jobId: string) => Promise<boolean>;
  /** Whether a row is still live (a cancelled job's worker stops). */
  readonly live: (jobId: string) => Promise<boolean>;
  /** The person's own rows for these jobs. */
  readonly forOwner: (
    owner: Owner,
    jobIds: readonly string[],
  ) => Promise<readonly WorkRow[]>;
};

/** A plain JSON value for a jsonb parameter (drops undefined, dates to strings). */
function asJson(value: unknown): Parameters<DatabaseExecutor["json"]>[0] {
  return JSON.parse(JSON.stringify(value)) as Parameters<
    DatabaseExecutor["json"]
  >[0];
}

const clip = (text: string | null, max: number) =>
  text === null ? null : text.trim().slice(0, max) || null;

export function createPostgresAgentWorkQueue(
  sql: DatabaseExecutor,
): AgentWorkQueue {
  return {
    enqueue: async (owner, input) => {
      await sql`
        insert into q_runtime.agent_work_queue (job_id, tenant_id, user_id, plan, trace)
        values (${input.jobId}, ${owner.tenantId}, ${owner.userId},
                ${sql.json(asJson(input.plan))},
                jsonb_strip_nulls(jsonb_build_object(
                  'actionId', ${input.trace.actionId ?? null}::text,
                  'runId', ${input.trace.runId ?? null}::text,
                  'organisationId', ${input.trace.organisationId ?? null}::text,
                  'conversationId', coalesce(${input.trace.conversationId ?? null}::text, (
                    select r.conversation_id::text from q_runtime.runs r
                     where r.id::text = ${input.trace.runId ?? null}::text
                       and r.tenant_id = ${owner.tenantId}
                     limit 1)))))
        on conflict (job_id) do nothing`;
    },

    claim: (workerId, leaseMs, limit) =>
      sql<WorkRow[]>`
        update q_runtime.agent_work_queue q
           set state = 'RUNNING', attempts = q.attempts + 1, locked_by = ${workerId},
               locked_until = clock_timestamp() + make_interval(secs => ${leaseMs / 1000}),
               heartbeat_at = clock_timestamp()
         where q.job_id in (
           select job_id from q_runtime.agent_work_queue
            where state in ('QUEUED', 'RUNNING', 'RECOVERING')
              and (locked_until is null or locked_until < clock_timestamp())
              and attempts < max_attempts
            order by created_at
            limit ${limit}
            for update skip locked)
        returning q.*`,

    heartbeat: async (jobId, workerId, leaseMs) =>
      (
        await sql`
          update q_runtime.agent_work_queue
             set locked_until = clock_timestamp() + make_interval(secs => ${leaseMs / 1000}),
                 heartbeat_at = clock_timestamp()
           where job_id = ${jobId} and locked_by = ${workerId} and state = 'RUNNING'
           returning job_id`
      ).length > 0,

    recordStep: async (jobId, workerId, stepKey, result, runId) => {
      await sql`
        update q_runtime.agent_work_queue
           set results = results || jsonb_build_object(${stepKey}::text, ${sql.json(
             asJson({
               status: result.status,
               summary: result.summary.slice(0, 500),
               outputs: result.outputs,
               runId,
             }),
           )}::jsonb)
         where job_id = ${jobId} and locked_by = ${workerId} and state = 'RUNNING'`;
    },

    finish: async (jobId, workerId, state, reason) =>
      (
        await sql`
          update q_runtime.agent_work_queue
             set state = ${state}, reason = ${clip(reason, 500)},
                 locked_by = null, locked_until = null, finished_at = clock_timestamp()
           where job_id = ${jobId} and locked_by = ${workerId} and state = 'RUNNING'
           returning job_id`
      ).length > 0,

    release: async (jobId, workerId, reason) => {
      await sql`
        update q_runtime.agent_work_queue
           set state = 'RECOVERING', reason = ${clip(reason, 500)},
               locked_by = null, locked_until = null
         where job_id = ${jobId} and locked_by = ${workerId} and state = 'RUNNING'`;
    },

    sweep: async () => {
      const recovering = await sql`
        update q_runtime.agent_work_queue
           set state = 'RECOVERING', locked_by = null, locked_until = null,
               reason = 'Q was interrupted while working on this; it will pick it up again.'
         where state = 'RUNNING' and locked_until < clock_timestamp()
           and attempts < max_attempts
         returning job_id`;
      const failed = await sql<
        Pick<WorkRow, "job_id" | "tenant_id" | "user_id">[]
      >`
        update q_runtime.agent_work_queue
           set state = 'FAILED', locked_by = null, locked_until = null,
               finished_at = clock_timestamp(),
               reason = 'This job stopped after ' || attempts::text
                        || ' tries; nothing more will be tried. Ask Q to start it again.'
         where state in ('QUEUED', 'RUNNING', 'RECOVERING')
           and attempts >= max_attempts
           and (locked_until is null or locked_until < clock_timestamp())
         returning job_id, tenant_id, user_id`;
      return { recovering: recovering.length, failed };
    },

    cancel: async (owner, jobId) =>
      (
        await sql`
          update q_runtime.agent_work_queue
             set state = 'CANCELLED', reason = 'Stopped by you.',
                 locked_by = null, locked_until = null, finished_at = clock_timestamp()
           where job_id = ${jobId} and tenant_id = ${owner.tenantId}
             and user_id = ${owner.userId}
             and state in ('QUEUED', 'RUNNING', 'RECOVERING')
           returning job_id`
      ).length > 0,

    live: async (jobId) =>
      (
        await sql`
          select 1 from q_runtime.agent_work_queue
           where job_id = ${jobId} and state in ('QUEUED', 'RUNNING', 'RECOVERING')`
      ).length > 0,

    forOwner: (owner, jobIds) =>
      jobIds.length === 0
        ? Promise.resolve([])
        : sql<WorkRow[]>`
            select * from q_runtime.agent_work_queue
             where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
               and job_id = any(${[...jobIds]}::uuid[])`,
  };
}

/**
 * The same queue in memory, for tests and local runs without a database:
 * the claim, the lease and its lapse behave as the table does, under an
 * injectable clock.
 */
export function createInMemoryAgentWorkQueue(
  now: () => number = () => Date.now(),
) {
  type Row = {
    -readonly [K in keyof WorkRow]: WorkRow[K];
  } & { locked_by: string | null; locked_until: number | null };
  const rows: Row[] = [];
  const live = (row: Row) => LIVE_WORK_STATES.includes(row.state);
  const held = (row: Row, workerId: string) =>
    row.locked_by === workerId && row.state === "RUNNING";
  const view = (row: Row): WorkRow => ({ ...row, results: { ...row.results } });
  const end = (row: Row, state: EndState, reason: string | null) => {
    row.state = state;
    row.reason = reason;
    row.locked_by = null;
    row.locked_until = null;
    row.finished_at = new Date(now());
  };
  const queue: AgentWorkQueue = {
    enqueue: (owner, input) => {
      if (!rows.some((row) => row.job_id === input.jobId)) {
        rows.push({
          job_id: input.jobId,
          tenant_id: owner.tenantId,
          user_id: owner.userId,
          state: "QUEUED",
          plan: input.plan,
          trace: { ...input.trace },
          results: {},
          attempts: 0,
          max_attempts: 3,
          reason: null,
          created_at: new Date(now()),
          updated_at: new Date(now()),
          finished_at: null,
          locked_by: null,
          locked_until: null,
        });
      }
      return Promise.resolve();
    },
    claim: (workerId, leaseMs, limit) => {
      const free = rows
        .filter(
          (row) =>
            live(row) &&
            (row.locked_until === null || row.locked_until < now()) &&
            row.attempts < row.max_attempts,
        )
        .slice(0, limit);
      for (const row of free) {
        row.state = "RUNNING";
        row.attempts += 1;
        row.locked_by = workerId;
        row.locked_until = now() + leaseMs;
      }
      return Promise.resolve(free.map(view));
    },
    heartbeat: (jobId, workerId, leaseMs) => {
      const row = rows.find((one) => one.job_id === jobId);
      if (row === undefined || !held(row, workerId)) {
        return Promise.resolve(false);
      }
      row.locked_until = now() + leaseMs;
      return Promise.resolve(true);
    },
    recordStep: (jobId, workerId, stepKey, result, runId) => {
      const row = rows.find((one) => one.job_id === jobId);
      if (row !== undefined && held(row, workerId)) {
        row.results = { ...row.results, [stepKey]: { ...result, runId } };
      }
      return Promise.resolve();
    },
    finish: (jobId, workerId, state, reason) => {
      const row = rows.find((one) => one.job_id === jobId);
      if (row === undefined || !held(row, workerId)) {
        return Promise.resolve(false);
      }
      end(row, state, reason);
      return Promise.resolve(true);
    },
    release: (jobId, workerId, reason) => {
      const row = rows.find((one) => one.job_id === jobId);
      if (row !== undefined && held(row, workerId)) {
        row.state = "RECOVERING";
        row.reason = reason;
        row.locked_by = null;
        row.locked_until = null;
      }
      return Promise.resolve();
    },
    sweep: () => {
      let recovering = 0;
      const failed: Pick<WorkRow, "job_id" | "tenant_id" | "user_id">[] = [];
      for (const row of rows) {
        const lapsed = row.locked_until !== null && row.locked_until < now();
        if (
          row.state === "RUNNING" &&
          lapsed &&
          row.attempts < row.max_attempts
        ) {
          row.state = "RECOVERING";
          row.reason =
            "Q was interrupted while working on this; it will pick it up again.";
          row.locked_by = null;
          row.locked_until = null;
          recovering += 1;
        } else if (
          live(row) &&
          row.attempts >= row.max_attempts &&
          (row.locked_until === null || lapsed)
        ) {
          end(
            row,
            "FAILED",
            `This job stopped after ${String(row.attempts)} tries; nothing more will be tried. Ask Q to start it again.`,
          );
          failed.push(row);
        }
      }
      return Promise.resolve({ recovering, failed });
    },
    cancel: (owner, jobId) => {
      const row = rows.find(
        (one) =>
          one.job_id === jobId &&
          one.tenant_id === owner.tenantId &&
          one.user_id === owner.userId,
      );
      if (row === undefined || !live(row)) return Promise.resolve(false);
      end(row, "CANCELLED", "Stopped by you.");
      return Promise.resolve(true);
    },
    live: (jobId) =>
      Promise.resolve(rows.some((row) => row.job_id === jobId && live(row))),
    forOwner: (owner, jobIds) =>
      Promise.resolve(
        rows
          .filter(
            (row) =>
              row.tenant_id === owner.tenantId &&
              row.user_id === owner.userId &&
              jobIds.includes(row.job_id),
          )
          .map(view),
      ),
  };
  return { ...queue, rows };
}

/**
 * Recovery D6: "Stop this job" for Q (the app action `q.work.job.stop`).
 * The person's own live work row ends CANCELLED, and its job STOPPED; the
 * worker running it starts no further step (its next step reads the row).
 */
export function workforceJobStopPort(
  queue: Pick<AgentWorkQueue, "cancel">,
  store: Pick<WorkforceStore, "setJobStatus">,
): WorkforceJobPort {
  return {
    stop: async (actor, jobId) => {
      const owner = { tenantId: actor.tenantId, userId: actor.userId };
      const stopped = await queue.cancel(owner, jobId);
      if (stopped) await store.setJobStatus(owner, jobId, "STOPPED");
      return stopped;
    },
  };
}
