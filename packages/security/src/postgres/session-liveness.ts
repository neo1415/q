import type { DatabaseExecutor } from "@capital-q/database";

import type { SessionLiveness } from "../supabase/local-jwt-authenticator.js";

/**
 * Is this Supabase session still alive (SUB-SECOND Phase 4)? A locally
 * verified access token proves who signed in, not that they are still
 * signed in: logout, a password change, a ban or a deleted user remove or
 * end the session while its token stays signed. One indexed lookup on
 * auth.sessions (primary key) joined to its user.
 */
export function createPostgresSessionLiveness(options: {
  readonly sql: DatabaseExecutor;
}): SessionLiveness {
  return {
    isLive: async ({ sessionId, authUserId }) => {
      const rows = await options.sql<{ live: boolean }[]>`
        select exists (
          select 1
            from auth.sessions s
            join auth.users u on u.id = s.user_id
           where s.id = ${sessionId}::uuid
             and s.user_id = ${authUserId}::uuid
             and (s.not_after is null or s.not_after > now())
             and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())
        ) as live`;
      return rows[0]?.live === true;
    },
  };
}
