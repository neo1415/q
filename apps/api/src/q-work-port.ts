import type { QWorkPagePort } from "@capital-q/app-actions";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * WORK-58: the Work page's own writes, the person's own rows only (every
 * predicate is their user and tenant). Pausing clears the next firing, as
 * stopping does; resuming makes it due at once and the instruction sweep's
 * claim restores its cadence. A budget pause is not resumed here: its
 * approval card does that (ADR 0043 S5). The same rules as q-api's
 * instruction store, which Q's `stop_q_work` tool (mode PAUSE or RESUME) goes through.
 */
export function createQWorkPagePort(sql: DatabaseExecutor): QWorkPagePort {
  return {
    pause: async (actor, id) =>
      (
        await sql<{ id: string }[]>`
          update q_runtime.standing_instructions
             set status = 'PAUSED', pause_reason = 'PAUSED_BY_YOU',
                 next_fire_at = null, updated_at = clock_timestamp()
           where id = ${id} and user_id = ${actor.userId}
             and tenant_id = ${actor.tenantId} and status = 'ACTIVE'
          returning id`
      ).length > 0,
    resume: async (actor, id) =>
      (
        await sql<{ id: string }[]>`
          update q_runtime.standing_instructions
             set status = 'ACTIVE', pause_reason = null,
                 next_fire_at = clock_timestamp(), updated_at = clock_timestamp()
           where id = ${id} and user_id = ${actor.userId}
             and tenant_id = ${actor.tenantId} and status = 'PAUSED'
             and pause_reason = 'PAUSED_BY_YOU'
             and (expires_at is null or expires_at > clock_timestamp())
          returning id`
      ).length > 0,
    dismiss: async (actor, key) => {
      await sql`
        insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
        values (${actor.tenantId}, ${actor.userId}, ${key})
        on conflict (user_id, suggestion_key) do nothing`;
    },
  };
}
