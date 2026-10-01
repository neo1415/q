import type { DatabaseExecutor } from "@capital-q/database";

import type { AdminGrant } from "./access.js";

/**
 * Audit search (spec §4): who acted, under whose authority, on what, with
 * what outcome -- across the tenant audit (`audit.material_actions`, where
 * Q always acts under a person's authority) and the console's own audit
 * (`platform_ops.admin_actions`). Read-only; cursor pagination.
 */

export type AuditQuery = {
  readonly source?: "ALL" | "TENANT" | "PLATFORM" | undefined;
  readonly actorUserId?: string | undefined;
  readonly actorType?:
    "human" | "q" | "capital_q_system" | "connected_system" | undefined;
  readonly actionPrefix?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly outcome?: "SUCCEEDED" | "FAILED" | "DENIED" | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

export type AuditRow = {
  readonly source: "TENANT" | "PLATFORM";
  readonly at: string;
  readonly actorType: string;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly authorityName: string | null;
  readonly actionType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly breakGlass: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export function encodeAuditCursor(at: string, key: string): string {
  return Buffer.from(`${at}|${key}`, "utf8").toString("base64url");
}

export function decodeAuditCursor(
  cursor: string | undefined,
): { readonly at: string; readonly key: string } | null {
  if (cursor === undefined || cursor.length === 0 || cursor.length > 200) {
    return null;
  }
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const [at, key] = text.split("|");
  if (at === undefined || key === undefined) return null;
  if (Number.isNaN(Date.parse(at)) || !/^[pt][0-9]{20}$/.test(key)) return null;
  return { at, key };
}

export async function searchAudit(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  query: AuditQuery,
): Promise<{
  readonly rows: readonly AuditRow[];
  readonly nextCursor: string | null;
}> {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  const source = query.source ?? "ALL";
  const cursor = decodeAuditCursor(query.cursor);
  const prefix =
    query.actionPrefix === undefined || query.actionPrefix.length === 0
      ? null
      : `${query.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<
    {
      source: "TENANT" | "PLATFORM";
      occurred_at: Date;
      cursor_at: string;
      sort_key: string;
      actor_type: string;
      actor_name: string | null;
      actor_role: string | null;
      authority_name: string | null;
      action_type: string;
      resource_type: string;
      resource_id: string;
      outcome: string;
      reason: string | null;
      break_glass: boolean;
      metadata: Record<string, unknown>;
    }[]
  >`
    select t.*, to_char(t.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
      from (
      select 'TENANT' as source, a.occurred_at, 't' || lpad(a.id::text, 20, '0') as sort_key,
             a.actor_type, ap.display_name as actor_name, null::text as actor_role,
             au.display_name as authority_name, a.action_type, a.resource_type,
             a.resource_id, a.outcome, null::text as reason, false as break_glass, a.metadata
        from audit.material_actions a
        left join identity.user_profiles ap on ap.id = a.actor_id
        left join identity.user_profiles au on au.id = a.authority_user_id
       where ${source !== "PLATFORM"}
         and (${query.actorUserId ?? null}::uuid is null
              or a.actor_id = ${query.actorUserId ?? null}::uuid
              or a.authority_user_id = ${query.actorUserId ?? null}::uuid)
         and (${query.actorType ?? null}::text is null or a.actor_type = ${query.actorType ?? null})
      union all
      select 'PLATFORM', x.occurred_at, 'p' || lpad(x.id::text, 20, '0'),
             'platform_admin', xp.display_name, x.actor_role, xp.display_name,
             x.action_type, x.resource_type, x.resource_id, x.outcome, x.reason,
             x.break_glass_id is not null, x.metadata
        from platform_ops.admin_actions x
        left join identity.user_profiles xp on xp.id = x.actor_user_id
       where ${source !== "TENANT"}
         and (${query.actorUserId ?? null}::uuid is null or x.actor_user_id = ${query.actorUserId ?? null}::uuid)
         and (${query.actorType ?? null}::text is null or ${query.actorType ?? null} = 'human')
    ) t
    where (${prefix}::text is null or t.action_type like ${prefix})
      and (${query.resourceType ?? null}::text is null or t.resource_type = ${query.resourceType ?? null})
      and (${query.resourceId ?? null}::text is null or t.resource_id = ${query.resourceId ?? null})
      and (${query.outcome ?? null}::text is null or t.outcome = ${query.outcome ?? null})
      and (${query.from ?? null}::timestamptz is null or t.occurred_at >= ${query.from ?? null}::timestamptz)
      and (${query.to ?? null}::timestamptz is null or t.occurred_at < ${query.to ?? null}::timestamptz)
      and (${cursor?.at ?? null}::timestamptz is null
           or t.occurred_at < ${cursor?.at ?? null}::timestamptz
           or (t.occurred_at = ${cursor?.at ?? null}::timestamptz and t.sort_key < ${cursor?.key ?? null}))
    order by t.occurred_at desc, t.sort_key desc
    limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      source: row.source,
      at: new Date(row.occurred_at).toISOString(),
      actorType: row.actor_type,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      authorityName: row.authority_name,
      actionType: row.action_type,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      reason: row.reason,
      breakGlass: row.break_glass,
      metadata: row.metadata ?? {},
    })),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeAuditCursor(last.cursor_at, last.sort_key)
        : null,
  };
}
