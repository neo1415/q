import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Everything the usage ledger says was spent since `dayStart`, across every
 * tenant and purpose: the aggregate the daily spend cap compares against
 * (policy/spend-cap.ts). Read-only; numeric summed in SQL and returned as
 * text, so no float accumulates across rows.
 */
export function createPostgresDailySpendReader(options: {
  readonly sql: DatabaseExecutor;
  /**
   * Only this task class's spend: a class with its own daily ceiling
   * (UI_TRANSLATION) counts itself; absent, everything is counted.
   */
  readonly taskClass?: string | undefined;
  /**
   * Only this purpose's spend: a path with its own daily ceiling that
   * shares a task class with others (PUBLIC_WEB_SEARCH) counts itself.
   * Takes precedence over `taskClass`.
   */
  readonly purpose?: string | undefined;
}): (dayStart: Date) => Promise<number> {
  return async (dayStart) => {
    if (options.purpose !== undefined) {
      const rows = await options.sql<{ usd: string }[]>`
      select coalesce(sum(cost_usd), 0)::text as usd
        from ai_ops.model_usage
       where occurred_at >= ${dayStart.toISOString()}::timestamptz
         and purpose = ${options.purpose}`;
      return Number(rows[0]?.usd ?? "0");
    }
    const rows =
      options.taskClass === undefined
        ? await options.sql<{ usd: string }[]>`
      select coalesce(sum(cost_usd), 0)::text as usd
        from ai_ops.model_usage
       where occurred_at >= ${dayStart.toISOString()}::timestamptz`
        : await options.sql<{ usd: string }[]>`
      select coalesce(sum(cost_usd), 0)::text as usd
        from ai_ops.model_usage
       where occurred_at >= ${dayStart.toISOString()}::timestamptz
         and task_class = ${options.taskClass}`;
    return Number(rows[0]?.usd ?? "0");
  };
}
