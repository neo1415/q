import {
  decodeJsonbString,
  jsonbParam,
  type DatabaseExecutor,
} from "@capital-q/database";
import type {
  PendingAppAction,
  PendingAppActionStore,
} from "@capital-q/q-specialists";

/**
 * The declared action a conversation waits on, kept on the conversation
 * row (20261129090000): it outlives a restart and is seen by every q-api
 * instance. Written and read by the server only; taken once.
 */
export function createPostgresAwaitingActions(dependencies: {
  readonly sql: DatabaseExecutor;
  /** How long a question waits for its answer. */
  readonly ttlMs?: number | undefined;
}): PendingAppActionStore {
  const { sql } = dependencies;
  const ttl = dependencies.ttlMs ?? 30 * 60_000;
  return {
    hold: async (scope, pending) => {
      // jsonbParam, not a pre-stringified `${text}::jsonb`: postgres.js
      // sends that as a JSON string, so the row held a string, never the
      // object (production 12 Nov: every row; see packages/database/jsonb).
      await sql`
        update q_runtime.conversations
           set awaiting_action = ${jsonbParam(sql, { ...pending, at: Date.now() })}::jsonb
         where id = ${scope.conversationId}
           and tenant_id = ${scope.tenantId}`;
    },
    take: async (scope) => {
      const rows = await sql<{ awaiting: unknown }[]>`
        update q_runtime.conversations c
           set awaiting_action = null
          from (select awaiting_action from q_runtime.conversations
                 where id = ${scope.conversationId}
                   and tenant_id = ${scope.tenantId}
                 for update) before
         where c.id = ${scope.conversationId}
           and c.tenant_id = ${scope.tenantId}
        returning before.awaiting_action as awaiting`;
      // A row written before the fix holds the string; read it as its value.
      const held = (decodeJsonbString(rows[0]?.awaiting ?? null) ??
        null) as PendingAppAction | null;
      if (
        held === null ||
        typeof held.at !== "number" ||
        Date.now() - held.at > ttl ||
        typeof held.action?.tool !== "string" ||
        typeof held.needs !== "string"
      ) {
        return null;
      }
      return held;
    },
  };
}
