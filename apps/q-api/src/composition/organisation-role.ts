import type { DatabaseExecutor } from "@capital-q/database";
import { teamRoleOf } from "@capital-q/organisations";
import type { ActorContext } from "@capital-q/security";

/**
 * Q-NAV (decisions 109 and 110): the role the actor's own membership holds
 * in the organisation they act for, read on the server from the membership
 * the actor context names (never from the client), with the same mapping
 * Team and the sidebar use (teamRoleOf). It decides which organisation
 * screens Q may offer; each page and the API still check for themselves.
 *
 * Null for someone acting for no organisation, or whose membership is not
 * active in it: offered none of the organisation's screens.
 */
export function createOrganisationRoleReader(sql: DatabaseExecutor) {
  return async (
    actor: ActorContext,
  ): Promise<"OWNER" | "ADMIN" | "MEMBER" | null> => {
    if (actor.organisationId === undefined || actor.membershipId === undefined)
      return null;
    const rows = await sql<{ role_codes: string[] }[]>`
      select coalesce(
               (select array_agg(r.code order by r.code)
                  from identity.membership_roles mr
                  join permissions.roles r on r.id = mr.role_id and r.status = 'active'
                 where mr.membership_id = m.id
                   and mr.valid_from <= now()
                   and (mr.valid_until is null or mr.valid_until > now())),
               '{}'::text[]) as role_codes
        from identity.organisation_memberships m
       where m.id = ${actor.membershipId}
         and m.user_id = ${actor.userId}
         and m.organisation_id = ${actor.organisationId}
         and m.membership_status = 'active'`;
    const row = rows[0];
    return row === undefined ? null : teamRoleOf(row.role_codes);
  };
}
