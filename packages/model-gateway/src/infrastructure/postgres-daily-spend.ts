import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Everything the usage ledger says was spent since `dayStart`, across every
 * tenant and purpose: the aggregate the daily spend cap compares against
 * (policy/spend-cap.ts). Read-only; numeric summed in SQL and returned as
 * text, so no float accumulates across rows.
 */
export function createPostgresDailySpendReader(options: {
  readonly sql: DatabaseExecutor;
}): (dayStart: Date) => Promise<number> {
  return async (dayStart) => {
    const rows = await options.sql<{ usd: string }[]>`
      select coalesce(sum(cost_usd), 0)::text as usd
        from ai_ops.model_usage
       where occurred_at >= ${dayStart.toISOString()}::timestamptz`;
    return Number(rows[0]?.usd ?? "0");
  };
}
