import type { DatabaseExecutor } from "@capital-q/database";

/** Owner-private trial counter; provider dollar accounting stays separate. */
export type LiveActiveTrialStore = {
  remaining(userId: string): Promise<number | null>;
  reserve(userId: string, sessionId: string): Promise<number | null>;
  checkpoint(
    userId: string,
    sessionId: string,
    activeMs: number,
  ): Promise<number>;
  release(userId: string, sessionId: string): Promise<void>;
};

export function createPostgresLiveActiveTrials(
  sql: DatabaseExecutor,
): LiveActiveTrialStore {
  return {
    remaining: async (userId) => {
      const rows = await sql<{ remaining: number }[]>`
        select allowance_ms - consumed_ms as remaining
          from q_runtime.voice_active_trials where user_id = ${userId}`;
      return rows[0]?.remaining ?? null;
    },
    reserve: async (userId, sessionId) => {
      const rows = await sql<{ remaining: number }[]>`
        update q_runtime.voice_active_trials
           set reserved_session_id = ${sessionId}::uuid, session_active_ms = 0,
               heartbeat_at = clock_timestamp()
         where user_id = ${userId} and reserved_session_id is null
           and consumed_ms < allowance_ms
        returning allowance_ms - consumed_ms as remaining`;
      return rows[0]?.remaining ?? null;
    },
    checkpoint: async (userId, sessionId, activeMs) => {
      const rows = await sql<{ remaining: number }[]>`
        update q_runtime.voice_active_trials
           set consumed_ms = least(allowance_ms, consumed_ms + greatest(0, ${activeMs} - session_active_ms)),
               session_active_ms = greatest(session_active_ms, ${activeMs}),
               heartbeat_at = clock_timestamp()
         where user_id = ${userId} and reserved_session_id = ${sessionId}::uuid
        returning allowance_ms - consumed_ms as remaining`;
      // A revoked/lost reservation cannot become a new allowance.
      return rows[0]?.remaining ?? 0;
    },
    release: async (userId, sessionId) => {
      await sql`
        update q_runtime.voice_active_trials
           set reserved_session_id = null, session_active_ms = 0, heartbeat_at = null
         where user_id = ${userId} and reserved_session_id = ${sessionId}::uuid`;
    },
  };
}
