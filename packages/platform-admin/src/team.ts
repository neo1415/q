import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";
import type { AdminRole } from "./permissions.js";

/**
 * The console's own team (ADR 0033 §2): only a platform_owner with a live
 * step-up grants, changes or revokes a role; never their own; never the
 * last platform_owner. Every change is appended to the role history.
 */

export type TeamMember = {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly role: AdminRole;
  readonly grantedAt: string;
  readonly grantedByName: string | null;
};

export async function listTeam(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
): Promise<readonly TeamMember[]> {
  const rows = await sql<
    {
      user_id: string;
      display_name: string | null;
      email: string | null;
      role: AdminRole;
      granted_at: Date;
      granted_by_name: string | null;
    }[]
  >`
    select a.user_id, p.display_name, u.email::text as email, a.role, a.granted_at,
           g.display_name as granted_by_name
      from identity.platform_admins a
      join identity.user_profiles p on p.id = a.user_id
      left join auth.users u on u.id = p.auth_user_id
      left join identity.user_profiles g on g.id = a.granted_by
     order by a.granted_at`;
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    email: row.email,
    role: row.role,
    grantedAt: new Date(row.granted_at).toISOString(),
    grantedByName: row.granted_by_name,
  }));
}

export type TeamChange =
  | { readonly kind: "DONE"; readonly userId: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "SELF" }
  | { readonly kind: "LAST_OWNER" }
  | { readonly kind: "UNCHANGED" };

async function owners(sql: DatabaseExecutor): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from identity.platform_admins where role = 'platform_owner'`;
  return row?.n ?? 0;
}

/** Grants a role to the account with this email, or changes an admin's role. */
export async function setTeamRole(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly email: string;
    readonly role: AdminRole;
    readonly reason: string;
  },
): Promise<TeamChange> {
  return transactions.run(async (tx): Promise<TeamChange> => {
    // Serialise team changes so the last-owner guard cannot race.
    await tx.sql`select pg_advisory_xact_lock(hashtext('platform_ops.team'))`;
    const [person] = await tx.sql<{ id: string }[]>`
      select p.id from identity.user_profiles p
      join auth.users u on u.id = p.auth_user_id
     where lower(u.email::text) = ${input.email.trim().toLowerCase()}`;
    if (person === undefined) return { kind: "NOT_FOUND" };
    if (person.id === grant.userId) return { kind: "SELF" };
    const [current] = await tx.sql<{ role: AdminRole }[]>`
      select role from identity.platform_admins where user_id = ${person.id}`;
    if (current?.role === input.role) return { kind: "UNCHANGED" };
    if (current?.role === "platform_owner" && (await owners(tx.sql)) <= 1) {
      return { kind: "LAST_OWNER" };
    }
    if (current === undefined) {
      await tx.sql`
        insert into identity.platform_admins (user_id, role, granted_by, note)
        values (${person.id}, ${input.role}, ${grant.userId}, ${input.reason.slice(0, 200)})`;
    } else {
      await tx.sql`
        update identity.platform_admins
           set role = ${input.role}, granted_by = ${grant.userId}
         where user_id = ${person.id}`;
    }
    await tx.sql`
      insert into platform_ops.admin_role_events
        (user_id, event, role, previous_role, actor_user_id, reason)
      values (${person.id}, ${current === undefined ? "GRANTED" : "CHANGED"},
              ${input.role}, ${current?.role ?? null}, ${grant.userId}, ${input.reason})`;
    await recordAdminAction(tx.sql, grant, {
      actionType:
        current === undefined ? "team.role.granted" : "team.role.changed",
      resourceType: "platform_admin",
      resourceId: person.id,
      reason: input.reason,
      metadata: { role: input.role, previousRole: current?.role ?? null },
    });
    return { kind: "DONE", userId: person.id };
  });
}

export async function revokeTeamRole(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: { readonly userId: string; readonly reason: string },
): Promise<TeamChange> {
  return transactions.run(async (tx): Promise<TeamChange> => {
    await tx.sql`select pg_advisory_xact_lock(hashtext('platform_ops.team'))`;
    if (input.userId === grant.userId) return { kind: "SELF" };
    const [current] = await tx.sql<{ role: AdminRole }[]>`
      select role from identity.platform_admins where user_id = ${input.userId}`;
    if (current === undefined) return { kind: "NOT_FOUND" };
    if (current.role === "platform_owner" && (await owners(tx.sql)) <= 1) {
      return { kind: "LAST_OWNER" };
    }
    await tx.sql`delete from identity.platform_admins where user_id = ${input.userId}`;
    await tx.sql`
      insert into platform_ops.admin_role_events
        (user_id, event, role, previous_role, actor_user_id, reason)
      values (${input.userId}, 'REVOKED', null, ${current.role}, ${grant.userId}, ${input.reason})`;
    await recordAdminAction(tx.sql, grant, {
      actionType: "team.role.revoked",
      resourceType: "platform_admin",
      resourceId: input.userId,
      reason: input.reason,
      metadata: { previousRole: current.role },
    });
    return { kind: "DONE", userId: input.userId };
  });
}
