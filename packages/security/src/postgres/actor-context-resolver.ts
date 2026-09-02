import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import { ActorContextSchema } from "../actor-context/actor-context.js";
import type {
  ActorContextResolution,
  ActorContextResolver,
} from "../actor-context/resolver.js";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "../identity/ids.js";

/**
 * Postgres-backed ActorContextResolver.
 *
 * Every value in the resulting ActorContext is read from trusted rows. The
 * caller contributes at most an organisation *selector*, which is a request,
 * not a claim: the membership row decides whether it is honoured.
 *
 * Resolution order (CQ-SEC-001 s45):
 *
 *   explicit organisation selector -> that active membership, or
 *                                     CONTEXT_NOT_ACCESSIBLE
 *   otherwise                      -> persisted active context whose
 *                                     membership is still active, or
 *                                     CONTEXT_REQUIRED
 *
 * There is no third branch. A person with exactly one active membership and
 * no persisted context still gets CONTEXT_REQUIRED; "the only row that came
 * back" is never a choice the system makes on their behalf.
 *
 * Resolution is a read. It never writes user_active_contexts.
 */

const ProfileRowSchema = z.object({ id: UserIdSchema });

const MembershipRowSchema = z.object({
  id: MembershipIdSchema,
  tenant_id: TenantIdSchema,
  organisation_id: OrganisationIdSchema,
});

export type PostgresActorContextResolverOptions = {
  readonly sql: DatabaseExecutor;
};

export function createPostgresActorContextResolver(
  options: PostgresActorContextResolverOptions,
): ActorContextResolver {
  const { sql } = options;

  return {
    resolveHumanContext: async ({
      principal,
      selection,
    }): Promise<ActorContextResolution> => {
      // AuthUserId -> UserId. A suspended or closed profile has no
      // application identity for the purposes of acting.
      const profileRows = await sql`
        select p.id
          from identity.user_profiles p
         where p.auth_user_id = ${principal.authUserId}
           and p.status = 'active'
         limit 1`;

      if (profileRows.length === 0) {
        return { status: "NO_APPLICATION_IDENTITY" };
      }
      const profile = ProfileRowSchema.safeParse(profileRows[0]);
      if (!profile.success) {
        return { status: "INVALID_CONTEXT" };
      }
      const userId = profile.data.id;

      const requested = selection?.organisationId;

      const membershipRows =
        requested === undefined
          ? await sql`
              select m.id, m.tenant_id, m.organisation_id
                from identity.user_active_contexts c
                join identity.organisation_memberships m
                  on m.id = c.membership_id
                 and m.user_id = c.user_id
               where c.user_id = ${userId}
                 and m.membership_status = 'active'
               limit 1`
          : await sql`
              select m.id, m.tenant_id, m.organisation_id
                from identity.organisation_memberships m
               where m.user_id = ${userId}
                 and m.organisation_id = ${requested}
                 and m.membership_status = 'active'
               limit 1`;

      if (membershipRows.length === 0) {
        // Whether the organisation exists, belongs to another tenant, or held
        // a membership that has since been revoked is not distinguished.
        return {
          status:
            requested === undefined
              ? "CONTEXT_REQUIRED"
              : "CONTEXT_NOT_ACCESSIBLE",
        };
      }

      const membership = MembershipRowSchema.safeParse(membershipRows[0]);
      if (!membership.success) {
        return { status: "INVALID_CONTEXT" };
      }

      const context = ActorContextSchema.safeParse({
        userId,
        tenantId: membership.data.tenant_id,
        organisationId: membership.data.organisation_id,
        membershipId: membership.data.id,
        // Only human requests travel this path (CQ-SEC-001 s101).
        actorType: "HUMAN",
      });
      if (!context.success) {
        return { status: "INVALID_CONTEXT" };
      }

      return { status: "RESOLVED", context: context.data };
    },
  };
}
