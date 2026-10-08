import type { DatabaseExecutor } from "@capital-q/database";
import type { ConversationCoreStore } from "@capital-q/q-specialists";

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
      if (value.length > 16_000) return;
      await sql`
        update q_runtime.conversations
           set core_state = ${value}::jsonb
         where id = ${scope.conversationId}
           and tenant_id = ${scope.tenantId}`;
    },
  };
}
