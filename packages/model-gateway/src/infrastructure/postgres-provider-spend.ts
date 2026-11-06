import type { ModelProviderCode } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { ProviderSpend } from "../policy/balance-watch.js";

/**
 * One provider's recorded spend from `ai_ops.model_usage` (cost priced at
 * call time from `ai_ops.model_prices`): since a stated balance, and over
 * the rate window. Read-only; amounts arrive as text so no float rounding
 * happens in the database driver.
 */
export function createPostgresProviderSpendReader(options: {
  readonly sql: DatabaseExecutor;
}): (input: {
  readonly providerCode: ModelProviderCode;
  readonly since: Date;
  readonly windowStart: Date;
}) => Promise<ProviderSpend> {
  return async ({ providerCode, since, windowStart }) => {
    const rows = await options.sql<
      { since_usd: string; window_usd: string; unpriced: number }[]
    >`
      select
        coalesce(sum(u.cost_usd) filter (
          where u.occurred_at >= ${since.toISOString()}::timestamptz), 0)::text
          as since_usd,
        coalesce(sum(u.cost_usd) filter (
          where u.occurred_at >= ${windowStart.toISOString()}::timestamptz), 0)::text
          as window_usd,
        (count(*) filter (
          where u.occurred_at >= ${windowStart.toISOString()}::timestamptz
            and u.cost_basis = 'UNPRICED'
            and (u.input_tokens + u.output_tokens) > 0))::int
          as unpriced
        from ai_ops.model_usage u
        join ai_ops.providers p on p.id = u.provider_id
       where p.code = ${providerCode}
         and u.occurred_at >= least(
               ${since.toISOString()}::timestamptz,
               ${windowStart.toISOString()}::timestamptz)`;
    const row = rows[0];
    return {
      providerCode,
      spentSinceAsOfUsd: Number(row?.since_usd ?? "0"),
      windowSpentUsd: Number(row?.window_usd ?? "0"),
      unpricedCalls: row?.unpriced ?? 0,
    };
  };
}
