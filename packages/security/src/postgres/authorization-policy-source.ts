import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type {
  AuthorizationDenial,
  AuthorizationGrant,
  AuthorizationPolicyFacts,
  AuthorizationPolicySource,
} from "../authorization/policy.js";
import { AuthorizationRequestSchema } from "../authorization/policy.js";
import {
  ResourceScopeSchema,
  type ResourceScope,
} from "../authorization/resource-scope.js";
import { TenantIdSchema } from "../identity/ids.js";

/**
 * Postgres-backed AuthorizationPolicySource.
 *
 * Reads policy *facts* -- current role assignments expanded through their
 * templates, and valid explicit grants/denials -- and hands them to
 * AuthorizationService, which owns the decision (deny by default, explicit
 * denial wins). Nothing here decides; nothing here looks at a role code, a
 * business title, an organisation type or membership metadata.
 *
 * Fail closed, always:
 *
 *   * a membership in the ActorContext that the database does not confirm as
 *     this person's, in this organisation and tenant, and active -> no facts;
 *   * any persisted grant whose scope does not parse, names another tenant,
 *     or contradicts its own resource columns -> no facts for the whole
 *     request, and the integrity failure is reported through the callback.
 *
 * Reporting is a callback rather than a logger dependency so the composition
 * root decides where integrity failures go. The payload never includes the
 * raw scope JSON.
 */

const NO_FACTS: AuthorizationPolicyFacts = {
  grants: [],
  denials: [],
  unmetRequirements: [],
};

const EffectSchema = z.enum(["ALLOW", "DENY"]);

const RoleFactRowSchema = z.object({
  role_id: UuidSchema,
  scope_type: z.enum(["tenant", "organisation"]),
  effect: EffectSchema,
});

const GrantRowSchema = z.object({
  id: UuidSchema,
  tenant_id: TenantIdSchema,
  effect: EffectSchema,
  scope: z.unknown(),
  resource_type: z.string().nullable(),
  resource_id: z.string().nullable(),
});

export type PolicyIntegrityFailure = {
  readonly source: "ROLE_TEMPLATE" | "EXPLICIT_GRANT";
  readonly reason:
    | "MALFORMED_ROW"
    | "MALFORMED_SCOPE"
    | "TENANT_MISMATCH"
    | "RESOURCE_MISMATCH"
    | "ORGANISATION_SCOPE_WITHOUT_ORGANISATION";
  readonly recordId: string | undefined;
};

export type PostgresAuthorizationPolicySourceOptions = {
  readonly sql: DatabaseExecutor;
  readonly onIntegrityFailure?:
    ((failure: PolicyIntegrityFailure) => void) | undefined;
};

export function createPostgresAuthorizationPolicySource(
  options: PostgresAuthorizationPolicySourceOptions,
): AuthorizationPolicySource {
  const { sql } = options;
  const report = options.onIntegrityFailure ?? (() => undefined);

  return {
    getPolicyFacts: async (request) => {
      // Never trust the shape of what arrived, even from internal code.
      const parsedRequest = AuthorizationRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return NO_FACTS;
      }
      const { actor, capability } = parsedRequest.data;

      // An organisation without a membership, or vice versa, is not a context
      // this source can read facts for.
      if (
        (actor.membershipId === undefined) !==
        (actor.organisationId === undefined)
      ) {
        return NO_FACTS;
      }

      const grants: AuthorizationGrant[] = [];
      const denials: AuthorizationDenial[] = [];
      let integrityFailed = false;
      const withMembership =
        actor.membershipId !== undefined && actor.organisationId !== undefined;

      // R5: one statement, one round trip (it was three, run on every
      // authorisation check). The same three reads as before, unchanged:
      //   member  the membership in the ActorContext is this person's, in
      //           this organisation and tenant, and active;
      //   roles   current assignments only, expanded through active
      //           templates, restricted to the capability being evaluated;
      //   grants  explicit grants/denials for the principals this actor
      //           embodies, valid by the database clock so it agrees with
      //           the transaction that may be running around this read.
      // Role facts are read only for a confirmed membership, as before.
      const [facts] = await sql<
        { member: boolean; roles: unknown; grants: unknown }[]
      >`
        with member as (
          select exists (
            select 1
              from identity.organisation_memberships m
             where m.id = ${actor.membershipId ?? null}
               and m.user_id = ${actor.userId}
               and m.organisation_id = ${actor.organisationId ?? null}
               and m.tenant_id = ${actor.tenantId}
               and m.membership_status = 'active'
          ) as confirmed
        )
        select
          (select confirmed from member) as member,
          coalesce((
            select json_agg(json_build_object(
                     'role_id', r.id, 'scope_type', r.scope_type, 'effect', rc.effect))
              from identity.membership_roles mr
              join permissions.roles r
                on r.id = mr.role_id and r.status = 'active'
              join permissions.role_capabilities rc
                on rc.role_id = r.id
              join permissions.capabilities c
                on c.id = rc.capability_id and c.status = 'active'
             where ${withMembership}
               and (select confirmed from member)
               and mr.membership_id = ${actor.membershipId ?? null}
               and mr.valid_from <= now()
               and (mr.valid_until is null or mr.valid_until > now())
               and c.code = ${capability}
          ), '[]'::json) as roles,
          coalesce((
            select json_agg(json_build_object(
                     'id', g.id, 'tenant_id', g.tenant_id, 'effect', g.effect,
                     'scope', g.scope, 'resource_type', g.resource_type,
                     'resource_id', g.resource_id))
              from permissions.grants g
              join permissions.capabilities c
                on c.id = g.capability_id and c.status = 'active'
             where g.tenant_id = ${actor.tenantId}
               and c.code = ${capability}
               and g.revoked_at is null
               and g.valid_from <= now()
               and (g.valid_until is null or g.valid_until > now())
               and (
                     (g.principal_type = 'user' and g.principal_id = ${actor.userId})
                  or (g.principal_type = 'membership' and g.principal_id = ${actor.membershipId ?? null})
                  or (g.principal_type = 'organisation' and g.principal_id = ${actor.organisationId ?? null})
               )
          ), '[]'::json) as grants`;
      if (facts === undefined) return NO_FACTS;
      if (withMembership && facts.member !== true) {
        return NO_FACTS;
      }
      const roleRows = Array.isArray(facts.roles) ? facts.roles : [];
      const grantRows = Array.isArray(facts.grants) ? facts.grants : [];

      const organisationId = actor.organisationId;
      if (withMembership && organisationId !== undefined) {
        for (const raw of roleRows) {
          const row = RoleFactRowSchema.safeParse(raw);
          if (!row.success) {
            integrityFailed = true;
            report({
              source: "ROLE_TEMPLATE",
              reason: "MALFORMED_ROW",
              recordId: undefined,
            });
            continue;
          }
          // Templates never name an organisation; the actor's own context
          // supplies it at evaluation time.
          const scope: ResourceScope =
            row.data.scope_type === "organisation"
              ? {
                  kind: "ORGANISATION",
                  tenantId: actor.tenantId,
                  organisationId,
                }
              : { kind: "TENANT", tenantId: actor.tenantId };

          if (row.data.effect === "ALLOW") {
            grants.push({ capability, scope, source: "ROLE_TEMPLATE" });
          } else {
            denials.push({ capability, scope, source: "EXPLICIT_DENIAL" });
          }
        }
      }

      for (const raw of grantRows) {
        const row = GrantRowSchema.safeParse(raw);
        if (!row.success) {
          integrityFailed = true;
          report({
            source: "EXPLICIT_GRANT",
            reason: "MALFORMED_ROW",
            recordId: undefined,
          });
          continue;
        }
        const recordId = row.data.id;

        const scope = ResourceScopeSchema.safeParse(row.data.scope);
        if (!scope.success) {
          integrityFailed = true;
          report({
            source: "EXPLICIT_GRANT",
            reason: "MALFORMED_SCOPE",
            recordId,
          });
          continue;
        }
        if (scope.data.tenantId !== row.data.tenant_id) {
          integrityFailed = true;
          report({
            source: "EXPLICIT_GRANT",
            reason: "TENANT_MISMATCH",
            recordId,
          });
          continue;
        }
        const resourceColumnsAgree =
          scope.data.kind === "RESOURCE"
            ? row.data.resource_type === scope.data.resourceType &&
              row.data.resource_id === scope.data.resourceId
            : row.data.resource_type === null && row.data.resource_id === null;
        if (!resourceColumnsAgree) {
          integrityFailed = true;
          report({
            source: "EXPLICIT_GRANT",
            reason: "RESOURCE_MISMATCH",
            recordId,
          });
          continue;
        }

        if (row.data.effect === "ALLOW") {
          grants.push({
            capability,
            scope: scope.data,
            source: "EXPLICIT_GRANT",
          });
        } else {
          denials.push({
            capability,
            scope: scope.data,
            source: "EXPLICIT_DENIAL",
          });
        }
      }

      // One corrupt policy row poisons the whole answer. Ignoring it and
      // authorising from the remaining rows would let a broken DENY row turn
      // into an ALLOW.
      if (integrityFailed) {
        return NO_FACTS;
      }

      return { grants, denials, unmetRequirements: [] };
    },
  };
}
