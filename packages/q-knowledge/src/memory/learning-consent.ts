import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Consent to learn communication preferences (lane ob1; owner decision
 * 2026-10-16: "with consent and user controls").
 *
 *   - Inferring a NEW communication preference from a conversation needs a
 *     GRANTED decision for this person in this tenant. No row is not
 *     granted, for every existing user too.
 *   - A preference the person states explicitly ("be brief with me") is
 *     consent by statement and is kept regardless (note_preference).
 *   - "Not now" is remembered: Q does not ask again for 30 days.
 *   - Turned off in Settings (REVOKED): never asked again; they turn it on
 *     there. What was already learned stays visible and deletable.
 *   - Per tenant: a decision in one organisation's workspace never applies
 *     in another.
 */

export const PREFERENCE_LEARNING_POLICY_VERSION =
  "preference-learning-2026-10-16";
export const NOT_NOW_DAYS = 30;

export type PreferenceLearningStatus =
  "NOT_ASKED" | "GRANTED" | "DECLINED" | "REVOKED";

export type PreferenceLearningChoice = "ALLOW" | "NOT_NOW" | "TURN_OFF";
export type PreferenceLearningVia = "PROMPT" | "CONVERSATION" | "SETTINGS";

export type PreferenceLearningState = {
  readonly status: PreferenceLearningStatus;
  /** Whether Q may put the question now (never while granted or turned off). */
  readonly mayAsk: boolean;
  readonly askAgainAfter: string | null;
};

type Row = {
  readonly status: "GRANTED" | "DECLINED" | "REVOKED";
  readonly askAgainAfter: Date | null;
};

/** The state from the stored decision. Pure. */
export function preferenceLearningState(
  row: Row | null,
  now: Date,
): PreferenceLearningState {
  if (row === null) {
    return { status: "NOT_ASKED", mayAsk: true, askAgainAfter: null };
  }
  if (row.status === "DECLINED") {
    const after = row.askAgainAfter ?? now;
    return {
      status: "DECLINED",
      mayAsk: after.getTime() <= now.getTime(),
      askAgainAfter: after.toISOString(),
    };
  }
  return { status: row.status, mayAsk: false, askAgainAfter: null };
}

export type PreferenceLearningConsent = {
  readonly state: (actor: ActorContext) => Promise<PreferenceLearningState>;
  /** Whether the learner may infer new communication preferences for this person. */
  readonly granted: (actor: ActorContext) => Promise<boolean>;
  readonly decide: (
    actor: ActorContext,
    choice: PreferenceLearningChoice,
    via: PreferenceLearningVia,
  ) => Promise<PreferenceLearningState>;
};

const StoredRow = z.object({
  status: z.enum(["GRANTED", "DECLINED", "REVOKED"]),
  ask_again_after: z
    .union([z.date(), z.string()])
    .nullable()
    .transform((v) =>
      v === null ? null : v instanceof Date ? v : new Date(v),
    ),
});

export function createPostgresPreferenceLearningConsent(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly now?: (() => Date) | undefined;
}): PreferenceLearningConsent {
  const { sql } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const read = async (actor: ActorContext): Promise<Row | null> => {
    const rows = await sql`
      select c.status, c.ask_again_after
        from q_knowledge.preference_learning_consents c
       where c.tenant_id = ${actor.tenantId} and c.user_id = ${actor.userId}`;
    if (rows.length === 0) return null;
    const row = StoredRow.parse(rows[0]);
    return { status: row.status, askAgainAfter: row.ask_again_after };
  };
  return {
    state: async (actor) => preferenceLearningState(await read(actor), now()),
    // Fails closed: a read that fails is not consent.
    granted: async (actor) =>
      (await read(actor).catch(() => null))?.status === "GRANTED",
    decide: async (actor, choice, via) => {
      const at = now();
      const status =
        choice === "ALLOW"
          ? "GRANTED"
          : choice === "NOT_NOW"
            ? "DECLINED"
            : "REVOKED";
      const askAgainAfter =
        status === "DECLINED"
          ? new Date(at.getTime() + NOT_NOW_DAYS * 24 * 60 * 60 * 1000)
          : null;
      await sql`
        insert into q_knowledge.preference_learning_consents as c
               (tenant_id, user_id, status, ask_again_after, decided_via,
                policy_version, decided_at)
        values (${actor.tenantId}, ${actor.userId}, ${status}, ${askAgainAfter},
                ${via}, ${PREFERENCE_LEARNING_POLICY_VERSION}, ${at})
        on conflict (tenant_id, user_id) do update
           set status          = excluded.status,
               ask_again_after = excluded.ask_again_after,
               decided_via     = excluded.decided_via,
               policy_version  = excluded.policy_version,
               decided_at      = excluded.decided_at`;
      return preferenceLearningState({ status, askAgainAfter }, at);
    },
  };
}
