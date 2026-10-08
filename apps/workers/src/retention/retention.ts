import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Retention for operational state nothing reads once it is old (audit
 * DEF-A9, F-D10). Two jobs, each bounded per pass and safe to run in any
 * number of workers at once:
 *
 *   RUN CHECKPOINTS  LangGraph checkpoints, blobs and writes are working
 *                    state for a run in flight (thread_id = run id). Once a
 *                    run is terminal and old, nothing resumes it. They were
 *                    ~90 MB of a 202 MB database with no pruning at all.
 *   VOICE ORPHANS    Duplex transcript turns of a line that never reached a
 *                    Q conversation had no deletion path. Turns linked to a
 *                    conversation go with it (cascade); unlinked ones go
 *                    after the retention period here.
 *
 * Each pass takes a transaction-scoped advisory lock and skips if another
 * worker holds it, so two replicas never delete the same batch twice.
 * Only ids and counts are logged.
 */

export const RETENTION = {
  /** Terminal runs older than this lose their checkpoints. */
  checkpointDays: 14,
  /** Unlinked voice transcript turns older than this are deleted. */
  orphanVoiceTurnDays: 30,
  /** Threads (runs) per checkpoint pass. */
  checkpointThreadsPerPass: 200,
  /** Turns per voice pass. */
  voiceTurnsPerPass: 1_000,
  intervalMs: 60 * 60 * 1_000,
} as const;

/** Arbitrary, fixed advisory-lock key for retention ("CQRETENT"). */
const RETENTION_LOCK = 0x4351_5245_5445_4e54n;

/** Run statuses after which nothing resumes a run's graph. */
export const TERMINAL_RUN_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type RetentionPass = {
  readonly skipped: boolean;
  readonly checkpointThreads: number;
  readonly checkpointRows: number;
  readonly voiceTurns: number;
};

export async function runRetentionPass(options: {
  readonly transactions: TransactionManager;
  readonly checkpointDays?: number | undefined;
  readonly orphanVoiceTurnDays?: number | undefined;
}): Promise<RetentionPass> {
  const checkpointDays = options.checkpointDays ?? RETENTION.checkpointDays;
  const voiceDays =
    options.orphanVoiceTurnDays ?? RETENTION.orphanVoiceTurnDays;
  return options.transactions.run(async (tx) => {
    const sql: DatabaseExecutor = tx.sql;
    const locked = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_xact_lock(${RETENTION_LOCK.toString()}::bigint) as locked`;
    if (locked[0]?.locked !== true) {
      return {
        skipped: true,
        checkpointThreads: 0,
        checkpointRows: 0,
        voiceTurns: 0,
      };
    }
    const threads = await pruneRunCheckpoints(sql, checkpointDays);
    const voiceTurns = await pruneOrphanVoiceLineTurns(sql, voiceDays);
    return {
      skipped: false,
      checkpointThreads: threads.threads,
      checkpointRows: threads.rows,
      voiceTurns,
    };
  });
}

export async function pruneRunCheckpoints(
  sql: DatabaseExecutor,
  olderThanDays: number,
  limit: number = RETENTION.checkpointThreadsPerPass,
): Promise<{ threads: number; rows: number }> {
  // Threads whose run is terminal and finished before the cutoff. A thread
  // with no run row is left alone: it is not ours to judge.
  const dead = await sql<{ thread_id: string }[]>`
    select distinct c.thread_id
      from q_runtime.checkpoints c
      join q_runtime.runs r on r.id::text = c.thread_id
     where r.status in ${sql(TERMINAL_RUN_STATUSES)}
       and coalesce(r.completed_at, r.created_at)
             < now() - make_interval(days => ${olderThanDays})
     limit ${limit}`;
  if (dead.length === 0) return { threads: 0, rows: 0 };
  const ids = dead.map((row) => row.thread_id);
  const writes = await sql`
    delete from q_runtime.checkpoint_writes where thread_id in ${sql(ids)}`;
  const blobs = await sql`
    delete from q_runtime.checkpoint_blobs where thread_id in ${sql(ids)}`;
  const headers = await sql`
    delete from q_runtime.checkpoints where thread_id in ${sql(ids)}`;
  return {
    threads: ids.length,
    rows: writes.count + blobs.count + headers.count,
  };
}

export async function pruneOrphanVoiceLineTurns(
  sql: DatabaseExecutor,
  olderThanDays: number,
  limit: number = RETENTION.voiceTurnsPerPass,
): Promise<number> {
  const deleted = await sql`
    delete from q_runtime.voice_line_turns
     where id in (
       select id from q_runtime.voice_line_turns
        where conversation_id is null
          and spoken_at < now() - make_interval(days => ${olderThanDays})
        order by spoken_at
        limit ${limit})`;
  return deleted.count;
}

export async function runRetentionTicker(options: {
  readonly transactions: TransactionManager;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  while (!options.signal.aborted) {
    try {
      const pass = await runRetentionPass({
        transactions: options.transactions,
      });
      if (pass.checkpointRows + pass.voiceTurns > 0) {
        options.logger.info({ ...pass }, "retention pass");
      }
    } catch {
      options.logger.warn({}, "retention pass failed; retrying next interval");
    }
    await sleep(options.intervalMs ?? RETENTION.intervalMs, options.signal);
  }
}
