import type { DatabaseExecutor } from "@capital-q/database";

import type { DuplexSpendLedger } from "../duplex/spend.js";
import { utcDayStart } from "../duplex/spend.js";

/**
 * Today's GPT-Live spend (V): its own rows on the VOICE_REALTIME ledger
 * (correlation ids `live_…`), across every tenant. Separate from the duplex
 * line's cap on purpose: before, GPT-Live seconds counted against the
 * duplex cap, so a day of GPT-Live use (or of fake sessions on the local
 * stack) refused the duplex line to everyone else (2026-10-09).
 */
export const LIVE_CORRELATION_PREFIX = "live_";

export function createPostgresLiveSpend(
  sql: DatabaseExecutor,
): DuplexSpendLedger {
  return {
    spentTodayUsd: async (at) => {
      const rows = await sql<{ usd: string }[]>`
        select coalesce(sum(cost_usd), 0)::text as usd
          from ai_ops.model_usage
         where purpose = 'VOICE_REALTIME'
           and left(correlation_id, 5) = 'live_'
           and occurred_at >= ${utcDayStart(at).toISOString()}::timestamptz`;
      const usd = Number(rows[0]?.usd ?? "0");
      if (!Number.isFinite(usd)) throw new Error("unreadable live spend");
      return usd;
    },
  };
}
