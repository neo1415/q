import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * Accounts and organisations (spec §4). Search and view read other
 * contexts' records; the only write is the operations suspension record.
 * Never a chat, never a document body.
 */

export type AccountRow = {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly createdAt: string;
  readonly suspended: boolean;
  readonly organisations: readonly string[];
};

export type AccountDetail = AccountRow & {
  readonly country: string | null;
  readonly memberships: readonly {
    readonly organisationId: string;
    readonly organisationName: string;
    readonly organisationType: string;
    readonly status: string;
    readonly roles: readonly string[];
  }[];
  readonly suspensions: readonly {
    readonly action: "SUSPENDED" | "UNSUSPENDED";
    readonly reason: string;
    readonly actorName: string | null;
    readonly occurredAt: string;
  }[];
  readonly qPaused: {
    readonly at: string;
    readonly reason: string | null;
  } | null;
  readonly counts: {
    readonly qRuns: number;
    readonly documents: number;
    readonly rehearsals: number;
  };
  readonly adminRole: string | null;
};

export type OrganisationRow = {
  readonly organisationId: string;
  readonly name: string;
  readonly type: string;
  readonly country: string | null;
  readonly members: number;
  readonly createdAt: string;
};

export type OrganisationDetail = OrganisationRow & {
  readonly website: string | null;
  readonly kind: "COMPANY" | "INVESTOR" | "OTHER";
  readonly relationships: number;
  readonly verification: readonly {
    readonly claimType: string;
    readonly status: string;
    readonly method: string | null;
    readonly at: string;
  }[];
  readonly memberList: readonly {
    readonly userId: string;
    readonly name: string | null;
    readonly status: string;
    readonly suspended: boolean;
  }[];
};

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/** `%` and `_` are literal in a search; the term is a prefix/infix of names. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function isSuspended(
  sql: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  try {
    const rows = await sql<{ action: string }[]>`
      select action from platform_ops.account_suspensions
       where user_id = ${userId}
       order by occurred_at desc, id desc limit 1`;
    return rows[0]?.action === "SUSPENDED";
  } catch (error: unknown) {
    // Before migration 20261115000000 is applied nobody can be suspended;
    // every other failure is a real failure.
    const shape = error as { sqlState?: unknown; code?: unknown } | null;
    if (shape?.sqlState === "42P01" || shape?.code === "42P01") return false;
    throw error;
  }
}

export async function searchAccounts(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  term: string,
): Promise<readonly AccountRow[]> {
  const pattern = likePattern(term.trim().slice(0, 100));
  const rows = await sql<
    {
      id: string;
      display_name: string | null;
      email: string | null;
      created_at: Date;
      suspended: boolean;
      organisations: string[] | null;
    }[]
  >`
    select p.id, p.display_name, u.email::text as email, p.created_at,
           coalesce((select s.action = 'SUSPENDED' from platform_ops.account_suspensions s
                      where s.user_id = p.id order by s.occurred_at desc, s.id desc limit 1), false) as suspended,
           (select array_agg(o.display_name order by o.display_name)
              from identity.organisation_memberships m
              join identity.organisations o on o.id = m.organisation_id
             where m.user_id = p.id and m.membership_status = 'active') as organisations
      from identity.user_profiles p
      left join auth.users u on u.id = p.auth_user_id
     where p.display_name ilike ${pattern}
        or u.email::text ilike ${pattern}
        or exists (select 1 from core.handles h
                    where h.subject_id = p.id and h.handle ilike ${pattern})
     order by p.created_at desc
     limit 25`;
  return rows.map((row) => ({
    userId: row.id,
    name: row.display_name,
    email: row.email,
    createdAt: iso(row.created_at),
    suspended: row.suspended,
    organisations: row.organisations ?? [],
  }));
}

export async function accountDetail(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  userId: string,
): Promise<AccountDetail | null> {
  const [person] = await sql<
    {
      id: string;
      display_name: string | null;
      email: string | null;
      country_code: string | null;
      created_at: Date;
      q_paused_at: Date | null;
      q_paused_reason: string | null;
      q_runs: number;
      documents: number;
      rehearsals: number;
      admin_role: string | null;
    }[]
  >`
    select p.id, p.display_name, u.email::text as email, p.country_code, p.created_at,
           s.suspended_at as q_paused_at, s.suspended_reason as q_paused_reason,
           (select count(*)::int from q_runtime.runs r where r.actor_user_id = p.id) as q_runs,
           (select count(*)::int from artifacts.artifacts a where a.created_by_user_id = p.id) as documents,
           (select count(*)::int from q_runtime.rehearsals h where h.user_id = p.id) as rehearsals,
           (select pa.role from identity.platform_admins pa where pa.user_id = p.id) as admin_role
      from identity.user_profiles p
      left join auth.users u on u.id = p.auth_user_id
      left join q_runtime.person_standing s on s.user_id = p.id
     where p.id = ${userId}`;
  if (person === undefined) return null;
  const memberships = await sql<
    {
      organisation_id: string;
      display_name: string;
      organisation_type: string;
      membership_status: string;
      roles: string[] | null;
    }[]
  >`
    select o.id as organisation_id, o.display_name, o.organisation_type, m.membership_status,
           (select array_agg(r.code order by r.code)
              from identity.membership_roles mr
              join permissions.roles r on r.id = mr.role_id
             where mr.membership_id = m.id
               and (mr.valid_until is null or mr.valid_until > now())) as roles
      from identity.organisation_memberships m
      join identity.organisations o on o.id = m.organisation_id
     where m.user_id = ${userId}
     order by m.created_at`;
  const suspensions = await sql<
    {
      action: "SUSPENDED" | "UNSUSPENDED";
      reason: string;
      actor: string | null;
      occurred_at: Date;
    }[]
  >`
    select s.action, s.reason, a.display_name as actor, s.occurred_at
      from platform_ops.account_suspensions s
      left join identity.user_profiles a on a.id = s.actor_user_id
     where s.user_id = ${userId}
     order by s.occurred_at desc, s.id desc limit 50`;
  return {
    userId: person.id,
    name: person.display_name,
    email: person.email,
    createdAt: iso(person.created_at),
    country: person.country_code,
    suspended: suspensions[0]?.action === "SUSPENDED",
    organisations: memberships
      .filter((m) => m.membership_status === "active")
      .map((m) => m.display_name),
    memberships: memberships.map((m) => ({
      organisationId: m.organisation_id,
      organisationName: m.display_name,
      organisationType: m.organisation_type,
      status: m.membership_status,
      roles: m.roles ?? [],
    })),
    suspensions: suspensions.map((s) => ({
      action: s.action,
      reason: s.reason,
      actorName: s.actor,
      occurredAt: iso(s.occurred_at),
    })),
    qPaused:
      person.q_paused_at === null
        ? null
        : { at: iso(person.q_paused_at), reason: person.q_paused_reason },
    counts: {
      qRuns: person.q_runs,
      documents: person.documents,
      rehearsals: person.rehearsals,
    },
    adminRole: person.admin_role,
  };
}

export type SuspensionOutcome =
  | { readonly kind: "DONE"; readonly suspended: boolean }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNCHANGED" }
  | { readonly kind: "SELF" };

/**
 * Suspends or lifts a suspension, with a reason, audited in the same
 * transaction. An admin never suspends themselves (DB check too).
 */
export async function setSuspension(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly userId: string;
    readonly suspend: boolean;
    readonly reason: string;
    readonly via?: string | undefined;
  },
): Promise<SuspensionOutcome> {
  if (input.userId === grant.userId) return { kind: "SELF" };
  return transactions.run(async (tx) => {
    const exists = await tx.sql<{ one: number }[]>`
      select 1 as one from identity.user_profiles where id = ${input.userId} for update`;
    if (exists.length === 0) return { kind: "NOT_FOUND" } as const;
    const current = await isSuspended(tx.sql, input.userId);
    if (current === input.suspend) return { kind: "UNCHANGED" } as const;
    const action = input.suspend ? "SUSPENDED" : "UNSUSPENDED";
    await tx.sql`
      insert into platform_ops.account_suspensions (user_id, action, reason, actor_user_id)
      values (${input.userId}, ${action}, ${input.reason}, ${grant.userId})`;
    await recordAdminAction(tx.sql, grant, {
      actionType: input.suspend ? "account.suspend" : "account.unsuspend",
      resourceType: "user_profile",
      resourceId: input.userId,
      reason: input.reason,
      metadata: input.via === undefined ? {} : { via: input.via },
    });
    return { kind: "DONE", suspended: input.suspend } as const;
  });
}

export async function searchOrganisations(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  term: string,
): Promise<readonly OrganisationRow[]> {
  const pattern = likePattern(term.trim().slice(0, 100));
  const rows = await sql<
    {
      id: string;
      display_name: string;
      organisation_type: string;
      country_code: string | null;
      members: number;
      created_at: Date;
    }[]
  >`
    select o.id, o.display_name, o.organisation_type, o.country_code, o.created_at,
           (select count(*)::int from identity.organisation_memberships m
             where m.organisation_id = o.id and m.membership_status = 'active') as members
      from identity.organisations o
     where o.display_name ilike ${pattern} or coalesce(o.legal_name, '') ilike ${pattern}
        or o.slug ilike ${pattern}
     order by o.created_at desc
     limit 25`;
  return rows.map((row) => ({
    organisationId: row.id,
    name: row.display_name,
    type: row.organisation_type,
    country: row.country_code,
    members: row.members,
    createdAt: iso(row.created_at),
  }));
}

export async function organisationDetail(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  organisationId: string,
): Promise<OrganisationDetail | null> {
  const [org] = await sql<
    {
      id: string;
      display_name: string;
      organisation_type: string;
      country_code: string | null;
      website_url: string | null;
      created_at: Date;
      company_id: string | null;
      investor_id: string | null;
    }[]
  >`
    select o.id, o.display_name, o.organisation_type, o.country_code, o.website_url, o.created_at,
           (select c.id from core.companies c where c.organisation_id = o.id limit 1) as company_id,
           (select i.id from core.investor_organisations i where i.organisation_id = o.id limit 1) as investor_id
      from identity.organisations o
     where o.id = ${organisationId}`;
  if (org === undefined) return null;
  const members = await sql<
    {
      user_id: string;
      display_name: string | null;
      membership_status: string;
      suspended: boolean;
    }[]
  >`
    select m.user_id, p.display_name, m.membership_status,
           coalesce((select s.action = 'SUSPENDED' from platform_ops.account_suspensions s
                      where s.user_id = m.user_id order by s.occurred_at desc, s.id desc limit 1), false) as suspended
      from identity.organisation_memberships m
      join identity.user_profiles p on p.id = m.user_id
     where m.organisation_id = ${organisationId}
     order by m.created_at`;
  const [relationships] = await sql<{ n: number }[]>`
    select count(*)::int as n from network.relationships r
     where r.company_id = ${org.company_id}::uuid or r.investor_organisation_id = ${org.investor_id}::uuid`;
  const verification = await sql<
    {
      claim_type: string;
      status: string;
      method: string | null;
      created_at: Date;
    }[]
  >`
    select distinct on (v.claim_type, v.subject_key) v.claim_type, v.status, v.method, v.created_at
      from evidence.verification_claims v
     where v.organisation_id = ${organisationId}
     order by v.claim_type, v.subject_key, v.revision desc`;
  return {
    organisationId: org.id,
    name: org.display_name,
    type: org.organisation_type,
    country: org.country_code,
    website: org.website_url,
    createdAt: iso(org.created_at),
    kind:
      org.company_id !== null
        ? "COMPANY"
        : org.investor_id !== null
          ? "INVESTOR"
          : "OTHER",
    members: members.filter((m) => m.membership_status === "active").length,
    relationships: relationships?.n ?? 0,
    verification: verification.map((v) => ({
      claimType: v.claim_type,
      status: v.status,
      method: v.method,
      at: iso(v.created_at),
    })),
    memberList: members.map((m) => ({
      userId: m.user_id,
      name: m.display_name,
      status: m.membership_status,
      suspended: m.suspended,
    })),
  };
}

/**
 * Suspending an organisation is suspending each active member, one audited
 * action per person: there is no hidden organisation-wide state.
 */
export async function suspendOrganisationMembers(
  sql: DatabaseExecutor,
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly organisationId: string;
    readonly suspend: boolean;
    readonly reason: string;
  },
): Promise<{ readonly changed: number } | null> {
  const members = await sql<{ user_id: string }[]>`
    select user_id from identity.organisation_memberships
     where organisation_id = ${input.organisationId} and membership_status = 'active'`;
  const exists = await sql<{ one: number }[]>`
    select 1 as one from identity.organisations where id = ${input.organisationId}`;
  if (exists.length === 0) return null;
  let changed = 0;
  for (const member of members) {
    if (member.user_id === grant.userId) continue;
    const outcome = await setSuspension(transactions, grant, {
      userId: member.user_id,
      suspend: input.suspend,
      reason: input.reason,
      via: `organisation:${input.organisationId}`,
    });
    if (outcome.kind === "DONE") changed += 1;
  }
  return { changed };
}
