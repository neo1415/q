import type { DatabaseExecutor } from "@capital-q/database";

/**
 * The plan for the q.action outbox rows that died before the worker
 * registry knew their type (DEF-A1). Each row is a canonical, validated
 * envelope the Approval Engine committed; only the publisher's registry was
 * wrong. Once the registry includes Q_ACTION_EVENTS:
 *
 *   REQUEUE (recommended)  attempts back to zero, so the next publisher
 *                          batch sends them. The worker archives types it
 *                          has no consumer for, and the declared consumers
 *                          re-read the action under their own authority
 *                          (REPLAY_SAFE), so a late delivery is harmless.
 *   DISCARD                delete them. The action's truth is in
 *                          q_runtime.actions and audit.material_actions;
 *                          only the integration event is lost.
 *
 * Only rows that failed for UNKNOWN_TYPE are touched: anything that failed
 * for another reason is a different defect and stays visible.
 */

export const DEAD_Q_ACTION_ERROR = "EVENT_SCHEMA_INVALID: UNKNOWN_TYPE";

export type DeadQActionMode = "DRY_RUN" | "REQUEUE" | "DISCARD";

export type DeadQActionSummary = {
  readonly mode: DeadQActionMode;
  /** Dead rows by event type, before any change. */
  readonly byType: Readonly<Record<string, number>>;
  readonly total: number;
  /** Rows changed (requeued or deleted); 0 for a dry run. */
  readonly changed: number;
};

/** Where the script may write: a loopback database, or a named approval. */
export function writeAllowed(options: {
  readonly databaseUrl: string | undefined;
  readonly hostedApprovedBy: string | undefined;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (options.databaseUrl === undefined || options.databaseUrl === "") {
    return { ok: false, reason: "DATABASE_URL is not set" };
  }
  let host: string;
  try {
    host = new URL(options.databaseUrl).hostname;
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a URL" };
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return { ok: true };
  }
  if (
    options.hostedApprovedBy !== undefined &&
    /^[A-Za-z][A-Za-z .'-]{1,63}$/.test(options.hostedApprovedBy)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "a non-local database needs --hosted-approved-by=<name of the person who approved this change>",
  };
}

export async function settleDeadQActionEvents(
  sql: DatabaseExecutor,
  mode: DeadQActionMode,
): Promise<DeadQActionSummary> {
  const rows = await sql<{ event_type: string; n: number }[]>`
    select event_type, count(*)::int as n
      from events.outbox
     where event_type like 'q.action.%'
       and published_at is null
       and last_error like ${`${DEAD_Q_ACTION_ERROR}%`}
     group by event_type
     order by event_type`;
  const byType: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byType[row.event_type] = row.n;
    total += row.n;
  }

  let changed = 0;
  if (mode === "REQUEUE") {
    const updated = await sql<{ id: string }[]>`
      update events.outbox
         set attempt_count = 0,
             last_error = null,
             available_at = greatest(available_at, now())
       where event_type like 'q.action.%'
         and published_at is null
         and last_error like ${`${DEAD_Q_ACTION_ERROR}%`}
      returning id`;
    changed = updated.length;
  } else if (mode === "DISCARD") {
    const deleted = await sql<{ id: string }[]>`
      delete from events.outbox
       where event_type like 'q.action.%'
         and published_at is null
         and last_error like ${`${DEAD_Q_ACTION_ERROR}%`}
      returning id`;
    changed = deleted.length;
  }

  return { mode, byType, total, changed };
}
