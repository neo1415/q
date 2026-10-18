import { z } from "zod";

import type { OnboardingNudgeStateRepository } from "../application/nudges.js";

/**
 * PostgreSQL adapter for `onboarding.nudge_states`. Parameterised SQL
 * only, keyed by the caller's own user id.
 */

const Time = z
  .union([z.date(), z.string()])
  .nullable()
  .transform((value) =>
    value === null ? null : value instanceof Date ? value : new Date(value),
  );

const StateRow = z.object({
  last_shown_at: Time,
  last_surface: z.enum(["BRIEFING", "Q_NOTE"]).nullable(),
  shown_count: z.coerce.number().int().min(0),
  last_conversation_id: z.string().nullable(),
  snoozed_until: Time,
  stopped_at: Time,
});

export function createPostgresOnboardingNudgeStateRepository(): OnboardingNudgeStateRepository {
  return {
    find: async (executor, userId) => {
      const rows = await executor`
        select n.last_shown_at, n.last_surface, n.shown_count,
               n.last_conversation_id, n.snoozed_until, n.stopped_at
          from onboarding.nudge_states n
         where n.user_id = ${userId}`;
      if (rows.length === 0) return null;
      const row = StateRow.parse(rows[0]);
      return {
        lastShownAt: row.last_shown_at,
        lastSurface: row.last_surface,
        shownCount: row.shown_count,
        lastConversationId: row.last_conversation_id,
        snoozedUntil: row.snoozed_until,
        stoppedAt: row.stopped_at,
      };
    },
    save: async (executor, userId, state, policyVersion) => {
      await executor`
        insert into onboarding.nudge_states as n
               (user_id, last_shown_at, last_surface, shown_count,
                last_conversation_id, snoozed_until, stopped_at,
                policy_version, updated_at)
        values (${userId}, ${state.lastShownAt}, ${state.lastSurface},
                ${state.shownCount}, ${state.lastConversationId},
                ${state.snoozedUntil}, ${state.stoppedAt},
                ${policyVersion}, clock_timestamp())
        on conflict (user_id) do update
           set last_shown_at        = excluded.last_shown_at,
               last_surface         = excluded.last_surface,
               shown_count          = excluded.shown_count,
               last_conversation_id = excluded.last_conversation_id,
               snoozed_until        = excluded.snoozed_until,
               stopped_at           = excluded.stopped_at,
               policy_version       = excluded.policy_version,
               updated_at           = excluded.updated_at`;
    },
  };
}
