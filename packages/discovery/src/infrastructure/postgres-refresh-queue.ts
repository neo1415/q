import type { DatabaseExecutor } from "@capital-q/database";

import type { RefreshQueue } from "../slates/refresh.js";

/**
 * The refresh queue as the API reaches it: one `pgmq.send` per message,
 * over ordinary server access, the same call the outbox dispatcher makes
 * for domain events. No queue provider, no second infrastructure; the
 * worker's runner reads the other end.
 */
export function createPostgresRefreshQueue(options: {
  readonly sql: DatabaseExecutor;
}): RefreshQueue {
  const { sql } = options;
  return {
    send: async (queue, message) => {
      const rows = await sql`
        select pgmq.send(${queue}, ${JSON.stringify(message)}::text::jsonb) as msg_id`;
      const first = rows[0] as { readonly msg_id?: unknown } | undefined;
      return Number(first?.msg_id ?? 0);
    },
  };
}
