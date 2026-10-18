import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Today's full-duplex spend (DUPLEX): the sum of the VOICE_REALTIME rows
 * the Model Gateway wrote to ai_ops.model_usage since 00:00 UTC, across
 * every tenant, because the cap is the provider account's, not a
 * person's. Read through a partial index (20261203090000).
 */
export type DuplexSpendLedger = {
  readonly spentTodayUsd: (at: Date) => Promise<number>;
};

export function utcDayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

export function createPostgresDuplexSpend(
  sql: DatabaseExecutor,
): DuplexSpendLedger {
  return {
    spentTodayUsd: async (at) => {
      const rows = await sql<{ usd: string }[]>`
        select coalesce(sum(cost_usd), 0)::text as usd
          from ai_ops.model_usage
         where purpose = 'VOICE_REALTIME'
           -- V: GPT-Live's seconds (live_…) have their own cap; they never
           -- refuse the duplex line to everyone else.
           and (correlation_id is null or left(correlation_id, 5) <> 'live_')
           and occurred_at >= ${utcDayStart(at).toISOString()}::timestamptz`;
      const usd = Number(rows[0]?.usd ?? "0");
      // A sum that cannot be read as a number is not "nothing spent".
      if (!Number.isFinite(usd)) throw new Error("unreadable realtime spend");
      return usd;
    },
  };
}
