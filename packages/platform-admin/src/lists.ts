import type { DatabaseExecutor } from "@capital-q/database";

import type { AdminGrant } from "./access.js";
import type { AccountRow, OrganisationRow } from "./accounts.js";

/**
 * The console's browse lists (admin design 2026-11-19 §4 T2): Accounts and
 * Organisations open with rows, newest first, and a search narrows them.
 * Keyset (cursor) pagination over a stable order, never an offset; the
 * total counts the filtered set. Read-only, for operators holding
 * accounts.read (the API checks the grant before calling).
 */

export const ADMIN_LIST_SORTS = [
  "newest",
  "oldest",
  "name_asc",
  "name_desc",
] as const;
export type AdminListSort = (typeof ADMIN_LIST_SORTS)[number];

export type AdminListQuery = {
  readonly q?: string | undefined;
  readonly sort?: AdminListSort | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

export type AdminListPage<Row> = {
  readonly rows: readonly Row[];
  readonly nextCursor: string | null;
  readonly total: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The cursor names the sort it belongs to, so a stale one is refused. */
export function encodeListCursor(
  sort: AdminListSort,
  key: string,
  id: string,
): string {
  return Buffer.from(JSON.stringify([sort, key, id]), "utf8").toString(
    "base64url",
  );
}

export function decodeListCursor(
  cursor: string | undefined,
  sort: AdminListSort,
): { readonly key: string; readonly id: string } | null {
  if (cursor === undefined || cursor.length === 0 || cursor.length > 400) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [kind, key, id] = value as unknown[];
  if (kind !== sort || typeof key !== "string" || typeof id !== "string") {
    return null;
  }
  if (!UUID.test(id) || key.length > 300) return null;
  if ((sort === "newest" || sort === "oldest") && Number.isNaN(Date.parse(key)))
    return null;
  return { key, id };
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 25, 50));
}

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

/** The keyset condition and order for one sort, over `key` and `id`. */
function keyset(
  sql: DatabaseExecutor,
  sort: AdminListSort,
  cursor: { readonly key: string; readonly id: string } | null,
) {
  const created = sort === "newest" || sort === "oldest";
  const descending = sort === "newest" || sort === "name_desc";
  const key = created ? sql`t.created_at` : sql`t.sort_name`;
  const cursorKey = created
    ? sql`${cursor?.key ?? null}::timestamptz`
    : sql`${cursor?.key ?? null}::text`;
  const after =
    cursor === null
      ? sql`true`
      : descending
        ? sql`(${key}, t.id) < (${cursorKey}, ${cursor.id}::uuid)`
        : sql`(${key}, t.id) > (${cursorKey}, ${cursor.id}::uuid)`;
  const order = descending
    ? sql`order by ${key} desc, t.id desc`
    : sql`order by ${key} asc, t.id asc`;
  return { after, order };
}

function nextCursorOf(
  sort: AdminListSort,
  rows: readonly {
    readonly id: string;
    readonly created_at: Date;
    readonly sort_name: string;
  }[],
  limit: number,
): string | null {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1];
  if (last === undefined) return null;
  const key =
    sort === "newest" || sort === "oldest"
      ? iso(last.created_at)
      : last.sort_name;
  return encodeListCursor(sort, key, last.id);
}

export async function listAccounts(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  query: AdminListQuery,
): Promise<AdminListPage<AccountRow>> {
  const sort = query.sort ?? "newest";
  const limit = clampLimit(query.limit);
  const term = (query.q ?? "").trim().slice(0, 100);
  const pattern = term.length === 0 ? null : likePattern(term);
  const cursor = decodeListCursor(query.cursor, sort);
  const { after, order } = keyset(sql, sort, cursor);
  // A fresh fragment per query: each statement carries its own copy.
  const filtered = () => sql`
    select p.id, p.display_name, u.email::text as email, p.created_at,
           lower(coalesce(p.display_name, '')) as sort_name
      from identity.user_profiles p
      left join auth.users u on u.id = p.auth_user_id
     where ${pattern}::text is null
        or p.display_name ilike ${pattern}
        or u.email::text ilike ${pattern}
        or exists (select 1 from core.handles h
                    where h.subject_id = p.id and h.handle ilike ${pattern})`;
  const [rows, counted] = await Promise.all([
    sql<
      {
        id: string;
        display_name: string | null;
        email: string | null;
        created_at: Date;
        sort_name: string;
        suspended: boolean;
        organisations: string[] | null;
      }[]
    >`
      select t.*,
             coalesce((select s.action = 'SUSPENDED' from platform_ops.account_suspensions s
                        where s.user_id = t.id order by s.occurred_at desc, s.id desc limit 1), false) as suspended,
             (select array_agg(o.display_name order by o.display_name)
                from identity.organisation_memberships m
                join identity.organisations o on o.id = m.organisation_id
               where m.user_id = t.id and m.membership_status = 'active') as organisations
        from (${filtered()}) t
       where ${after}
       ${order}
       limit ${limit + 1}`,
    sql<
      { total: number }[]
    >`select count(*)::int as total from (${filtered()}) t`,
  ]);
  return {
    rows: rows.slice(0, limit).map((row) => ({
      userId: row.id,
      name: row.display_name,
      email: row.email,
      createdAt: iso(row.created_at),
      suspended: row.suspended,
      organisations: row.organisations ?? [],
    })),
    nextCursor: nextCursorOf(sort, rows, limit),
    total: counted[0]?.total ?? 0,
  };
}

export async function listOrganisations(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  query: AdminListQuery,
): Promise<AdminListPage<OrganisationRow>> {
  const sort = query.sort ?? "newest";
  const limit = clampLimit(query.limit);
  const term = (query.q ?? "").trim().slice(0, 100);
  const pattern = term.length === 0 ? null : likePattern(term);
  const cursor = decodeListCursor(query.cursor, sort);
  const { after, order } = keyset(sql, sort, cursor);
  const filtered = () => sql`
    select o.id, o.display_name, o.organisation_type, o.country_code, o.created_at,
           lower(o.display_name) as sort_name
      from identity.organisations o
     where ${pattern}::text is null
        or o.display_name ilike ${pattern}
        or coalesce(o.legal_name, '') ilike ${pattern}
        or o.slug ilike ${pattern}`;
  const [rows, counted] = await Promise.all([
    sql<
      {
        id: string;
        display_name: string;
        organisation_type: string;
        country_code: string | null;
        created_at: Date;
        sort_name: string;
        members: number;
      }[]
    >`
      select t.*,
             (select count(*)::int from identity.organisation_memberships m
               where m.organisation_id = t.id and m.membership_status = 'active') as members
        from (${filtered()}) t
       where ${after}
       ${order}
       limit ${limit + 1}`,
    sql<
      { total: number }[]
    >`select count(*)::int as total from (${filtered()}) t`,
  ]);
  return {
    rows: rows.slice(0, limit).map((row) => ({
      organisationId: row.id,
      name: row.display_name,
      type: row.organisation_type,
      country: row.country_code,
      members: row.members,
      createdAt: iso(row.created_at),
    })),
    nextCursor: nextCursorOf(sort, rows, limit),
    total: counted[0]?.total ?? 0,
  };
}
