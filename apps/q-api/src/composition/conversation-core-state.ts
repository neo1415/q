import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import {
  discoveryActiveIn,
  type ConversationCoreStore,
} from "@capital-q/q-specialists";

/** conversations_core_state_check (20261220200000). */
const CORE_STATE_MAX_CHARS = 16_384;

/**
 * RECOVERY-2026-10 B3 (audit B-02): the conversation core's state on the
 * conversation row (20261220200000), so "try again", a question series,
 * the unclear count and the tool focus survive a deploy and are the same
 * on every q-api instance. Written and read by the server only, scoped by
 * tenant and conversation; the answer seam validates what it reads back.
 */
export function createPostgresConversationCore(dependencies: {
  readonly sql: DatabaseExecutor;
}): ConversationCoreStore {
  const { sql } = dependencies;
  return {
    load: async (scope) => {
      const rows = await sql<{ core_state: unknown }[]>`
        select core_state from q_runtime.conversations
         where id = ${scope.conversationId}
           and tenant_id = ${scope.tenantId}`;
      return rows[0]?.core_state ?? null;
    },
    save: async (scope, snapshot) => {
      const value = JSON.stringify(snapshot);
      // Over the column's bound: keep the row as it was rather than fail.
      // The bound is measured on jsonb's text form, which adds a space
      // after every ":" and "," (live 2026-10-09: a 16,000-character
      // snapshot broke conversations_core_state_check), so the database
      // measures it in the same statement. This is only a cheap pre-cut.
      if (value.length > CORE_STATE_MAX_CHARS) return;
      // jsonbParam, not a pre-stringified `${text}::jsonb`: postgres.js
      // sends that as a JSON string, so `jsonb_typeof = object` refused
      // every save (production 12 Nov: every row; see packages/database/jsonb).
      await sql`
        update q_runtime.conversations
           set core_state = candidate.value
          from (select ${jsonbParam(sql, snapshot)}::jsonb as value) as candidate
         where id = ${scope.conversationId}
           and tenant_id = ${scope.tenantId}
           and jsonb_typeof(candidate.value) = 'object'
           and length(candidate.value::text) <= ${CORE_STATE_MAX_CHARS}`;
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A voice line opens without waiting longer than this for the read. */
export const DISCOVERY_READ_DEADLINE_MS = 300;

/**
 * HQ-5: whether the person's own conversation is in discovery (its core
 * snapshot), so a voice line opened on it takes turns patiently. Read by
 * tenant, conversation and owner: never another person's conversation.
 * Slow, failed or unreadable: false, and the line opens as before.
 */
export function createConversationDiscoveryRead(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly deadlineMs?: number | undefined;
}): (actor: ActorContext, conversationId: string) => Promise<boolean> {
  const { sql } = dependencies;
  const deadline = dependencies.deadlineMs ?? DISCOVERY_READ_DEADLINE_MS;
  return async (actor, conversationId) => {
    if (!UUID.test(conversationId)) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadline);
    });
    const read = sql<{ core_state: unknown }[]>`
      select core_state from q_runtime.conversations
       where id = ${conversationId}
         and tenant_id = ${actor.tenantId}
         and user_id = ${actor.userId}`.then(
      (rows) => rows[0]?.core_state ?? null,
      () => null,
    );
    const stored = await Promise.race([read, late]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    return discoveryActiveIn(stored);
  };
}
