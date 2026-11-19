import type { DatabaseExecutor } from "@capital-q/database";

import type { AdminGrant } from "./access.js";

/**
 * The console overview's own figures (admin design 2026-11-19 §4 T1), from
 * the platform's existing tables only, read-only. Model spend counts
 * priced calls only (cost_basis PRICE_SNAPSHOT or ESTIMATED); calls with
 * no price are counted apart, never as zero cost. Days are UTC.
 */

export type ConsoleOverview = {
  /** Organisations with at least one active member. */
  readonly activeOrganisations: number;
  readonly spend: {
    /** This calendar month, UTC, as YYYY-MM. */
    readonly month: string;
    readonly pricedUsd: string;
    readonly pricedCalls: number;
    readonly unpricedCalls: number;
  };
  /** The last 14 UTC days, oldest first, every day present. */
  readonly daily: readonly {
    readonly day: string;
    readonly pricedUsd: string;
    readonly calls: number;
    readonly unpricedCalls: number;
  }[];
  /** Events not yet handed to the queue, and how long the oldest has waited. */
  readonly outbox: {
    readonly pending: number;
    readonly oldestPendingSeconds: number | null;
  };
};

export const CONSOLE_SPEND_DAYS = 14;

/** Every UTC day from `days - 1` days before `now` to `now`, as YYYY-MM-DD. */
export function lastDays(now: Date, days: number): readonly string[] {
  const out: string[] = [];
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(new Date(today - back * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export async function consoleOverview(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  now: Date = new Date(),
): Promise<ConsoleOverview> {
  const days = lastDays(now, CONSOLE_SPEND_DAYS);
  const first = days[0] ?? now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const [counts, spend, daily, outbox] = await Promise.all([
    sql<{ active: number }[]>`
      select count(*)::int as active from identity.organisations o
       where exists (select 1 from identity.organisation_memberships m
                      where m.organisation_id = o.id and m.membership_status = 'active')`,
    sql<{ priced: string; priced_calls: number; unpriced_calls: number }[]>`
      select coalesce(sum(cost_usd) filter (where cost_basis <> 'UNPRICED'), 0)::text as priced,
             (count(*) filter (where cost_basis <> 'UNPRICED'))::int as priced_calls,
             (count(*) filter (where cost_basis = 'UNPRICED'))::int as unpriced_calls
        from ai_ops.model_usage
       where occurred_at >= ${`${month}-01T00:00:00.000Z`}::timestamptz`,
    sql<
      { day: string; priced: string; calls: number; unpriced_calls: number }[]
    >`
      select to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') as day,
             coalesce(sum(cost_usd) filter (where cost_basis <> 'UNPRICED'), 0)::text as priced,
             count(*)::int as calls,
             (count(*) filter (where cost_basis = 'UNPRICED'))::int as unpriced_calls
        from ai_ops.model_usage
       where occurred_at >= ${`${first}T00:00:00.000Z`}::timestamptz
       group by 1`,
    sql<{ pending: number; oldest: number | null }[]>`
      select count(*)::int as pending,
             extract(epoch from (${now.toISOString()}::timestamptz - min(available_at)))::int as oldest
        from events.outbox
       where published_at is null`,
  ]);
  const byDay = new Map(daily.map((row) => [row.day, row]));
  return {
    activeOrganisations: counts[0]?.active ?? 0,
    spend: {
      month,
      pricedUsd: spend[0]?.priced ?? "0",
      pricedCalls: spend[0]?.priced_calls ?? 0,
      unpricedCalls: spend[0]?.unpriced_calls ?? 0,
    },
    daily: days.map((day) => {
      const row = byDay.get(day);
      return {
        day,
        pricedUsd: row?.priced ?? "0",
        calls: row?.calls ?? 0,
        unpricedCalls: row?.unpriced_calls ?? 0,
      };
    }),
    outbox: {
      pending: outbox[0]?.pending ?? 0,
      oldestPendingSeconds:
        (outbox[0]?.pending ?? 0) === 0
          ? null
          : Math.max(0, outbox[0]?.oldest ?? 0),
    },
  };
}
