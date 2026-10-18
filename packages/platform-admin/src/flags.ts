import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * Kill switches for Q autonomy and the Q Daily (spec §4). A row per
 * switch; every change names who and why and is appended to the history.
 * Off means no new step starts; work in progress stops at its next step.
 */

export const KILL_SWITCHES = [
  "q.autonomy.errands",
  "q.autonomy.delegations",
  "q.daily",
] as const;
export type KillSwitch = (typeof KILL_SWITCHES)[number];

export function isKillSwitch(value: unknown): value is KillSwitch {
  return (
    typeof value === "string" &&
    (KILL_SWITCHES as readonly string[]).includes(value)
  );
}

export type FlagRow = {
  readonly key: string;
  readonly enabled: boolean;
  readonly description: string;
  readonly updatedByName: string | null;
  readonly reason: string | null;
  readonly updatedAt: string;
  readonly history: readonly {
    readonly enabled: boolean;
    readonly actorName: string | null;
    readonly reason: string;
    readonly at: string;
  }[];
};

export async function listFlags(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
): Promise<readonly FlagRow[]> {
  const flags = await sql<
    {
      key: string;
      enabled: boolean;
      description: string;
      updated_by_name: string | null;
      reason: string | null;
      updated_at: Date;
    }[]
  >`
    select f.key, f.enabled, f.description, p.display_name as updated_by_name,
           f.reason, f.updated_at
      from platform_ops.feature_flags f
      left join identity.user_profiles p on p.id = f.updated_by
     order by f.key`;
  const history = await sql<
    {
      key: string;
      enabled: boolean;
      actor: string | null;
      reason: string;
      occurred_at: Date;
    }[]
  >`
    select e.key, e.enabled, p.display_name as actor, e.reason, e.occurred_at
      from platform_ops.feature_flag_events e
      left join identity.user_profiles p on p.id = e.actor_user_id
     order by e.occurred_at desc
     limit 100`;
  return flags.map((flag) => ({
    key: flag.key,
    enabled: flag.enabled,
    description: flag.description,
    updatedByName: flag.updated_by_name,
    reason: flag.reason,
    updatedAt: new Date(flag.updated_at).toISOString(),
    history: history
      .filter((event) => event.key === flag.key)
      .slice(0, 10)
      .map((event) => ({
        enabled: event.enabled,
        actorName: event.actor,
        reason: event.reason,
        at: new Date(event.occurred_at).toISOString(),
      })),
  }));
}

export async function setFlag(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly key: KillSwitch;
    readonly enabled: boolean;
    readonly reason: string;
  },
): Promise<"CHANGED" | "UNCHANGED" | "NOT_FOUND"> {
  return transactions.run(async (tx) => {
    const [current] = await tx.sql<{ enabled: boolean }[]>`
      select enabled from platform_ops.feature_flags where key = ${input.key} for update`;
    if (current === undefined) return "NOT_FOUND";
    if (current.enabled === input.enabled) return "UNCHANGED";
    await tx.sql`
      update platform_ops.feature_flags
         set enabled = ${input.enabled}, updated_by = ${grant.userId},
             reason = ${input.reason}, updated_at = clock_timestamp()
       where key = ${input.key}`;
    await tx.sql`
      insert into platform_ops.feature_flag_events (key, enabled, actor_user_id, reason)
      values (${input.key}, ${input.enabled}, ${grant.userId}, ${input.reason})`;
    await recordAdminAction(tx.sql, grant, {
      actionType: input.enabled ? "flag.enabled" : "flag.disabled",
      resourceType: "feature_flag",
      resourceId: input.key,
      reason: input.reason,
    });
    return "CHANGED";
  });
}

/**
 * The reader every runtime uses (errands, AUTO delegations, the Q Daily).
 * Cached briefly so a hot path costs one query per few seconds. If the
 * flag cannot be read (the table is not there yet, the database blips) the
 * switch reads as ON: a kill switch must never become an outage, and the
 * work it guards still passes its own authorisation.
 */
export function createFlagReader(
  sql: DatabaseExecutor,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): { readonly isEnabled: (key: KillSwitch) => Promise<boolean> } {
  const ttl = options.ttlMs ?? 5_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: boolean; at: number }>();
  return {
    isEnabled: async (key) => {
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < ttl) return hit.value;
      let value: boolean;
      try {
        const rows = await sql<{ enabled: boolean }[]>`
          select enabled from platform_ops.feature_flags where key = ${key}`;
        value = rows[0]?.enabled ?? true;
      } catch {
        value = true;
      }
      cache.set(key, { value, at: now() });
      return value;
    },
  };
}
