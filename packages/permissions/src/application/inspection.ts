import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  ActorContextSchema,
  type ActorContext,
  type AuthorizationService,
  type OrganisationId,
  type UserId,
} from "@capital-q/security";

import {
  DisclosureResourceRefSchema,
  policyStatusAt,
  type DisclosureAccessLevel,
  type DisclosurePolicyId,
  type DisclosurePolicyStatus,
  type DisclosureRecipient,
  type DisclosureResourceRef,
  type DisclosureScope,
  type UtcTimestamp,
} from "../contracts/index.js";
import { DisclosureResourceNotFoundError } from "../domain/errors.js";
import { DISCLOSURE_INSPECT } from "./policy-manager.js";
import type {
  DisclosureClock,
  DisclosurePolicyRepository,
  DisclosureResourceResolverRegistry,
  RelationshipPartyResolver,
} from "./ports.js";

/**
 * "Who can see this?" for the legitimate owner/manager of a resource.
 * Requires disclosure.inspect over the owning scope: a recipient of a share
 * does not learn the rest of the recipient list merely by holding access.
 * Returns the base scope and every explicit policy with its lifecycle
 * status; a revoked share is reported as revoked, and a recipient still
 * reachable through another active path is not reported as "no access"
 * because the paths are listed, not netted.
 */

export type InspectResourceDisclosureQuery = {
  readonly actor: ActorContext;
  readonly resource: DisclosureResourceRef;
};

const QuerySchema = z
  .object({ actor: ActorContextSchema, resource: DisclosureResourceRefSchema })
  .strict();

export type DisclosurePolicyInspection = {
  readonly id: DisclosurePolicyId;
  readonly scopeType: DisclosureScope;
  readonly recipient: DisclosureRecipient | null;
  readonly accessLevel: DisclosureAccessLevel;
  readonly expiresAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly revokedAt: UtcTimestamp | null;
  readonly status: DisclosurePolicyStatus;
};

export type ResourceDisclosureInspection = {
  readonly resource: DisclosureResourceRef;
  readonly intrinsicScope: DisclosureScope | null;
  readonly ownerUserId: UserId | null;
  readonly ownerOrganisationId: OrganisationId | null;
  readonly relationshipId: string | null;
  readonly policies: readonly DisclosurePolicyInspection[];
};

export type InspectResourceDisclosure = (
  query: InspectResourceDisclosureQuery,
) => Promise<ResourceDisclosureInspection>;

export function createInspectResourceDisclosure(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly authorization: AuthorizationService;
  readonly clock: DisclosureClock;
  readonly policies: DisclosurePolicyRepository;
  readonly resolvers: DisclosureResourceResolverRegistry;
  readonly relationshipParties: RelationshipPartyResolver;
}): InspectResourceDisclosure {
  const {
    sql,
    authorization,
    clock,
    policies,
    resolvers,
    relationshipParties,
  } = dependencies;
  return async (raw) => {
    const query = QuerySchema.parse(raw);
    const descriptor = await resolvers.resolve(query.resource);
    if (descriptor === null) {
      throw new DisclosureResourceNotFoundError();
    }

    // Same authority scope rule as the manager: the owning organisation,
    // or a canonical party of a bilateral resource, in its own tenant.
    let organisationId: OrganisationId | undefined =
      descriptor.ownerOrganisationId;
    let tenantId = descriptor.tenantId;
    if (
      organisationId === undefined &&
      descriptor.relationshipId !== undefined
    ) {
      const parties = await relationshipParties.resolve(
        descriptor.relationshipId,
      );
      const actorOrganisation = query.actor.organisationId;
      if (
        parties !== null &&
        actorOrganisation !== undefined &&
        ((actorOrganisation === parties.company.organisationId &&
          query.actor.tenantId === parties.company.tenantId) ||
          (actorOrganisation === parties.investor.organisationId &&
            query.actor.tenantId === parties.investor.tenantId))
      ) {
        organisationId = actorOrganisation;
        tenantId = query.actor.tenantId;
      }
    }
    await authorization.requireCapability({
      actor: query.actor,
      capability: DISCLOSURE_INSPECT,
      resource: {
        kind: "RESOURCE",
        tenantId,
        ...(organisationId === undefined ? {} : { organisationId }),
        resourceType: descriptor.resource.type,
        resourceId: descriptor.resource.id,
      },
    });

    const now = clock.now();
    const rows = await policies.findAllForResource(sql, query.resource);
    return {
      resource: descriptor.resource,
      intrinsicScope: descriptor.intrinsicScope ?? null,
      ownerUserId: descriptor.ownerUserId ?? null,
      ownerOrganisationId: descriptor.ownerOrganisationId ?? null,
      relationshipId: descriptor.relationshipId ?? null,
      policies: rows.map((policy) => ({
        id: policy.id,
        scopeType: policy.scopeType,
        recipient: policy.recipient,
        accessLevel: policy.accessLevel,
        expiresAt: policy.expiresAt,
        createdAt: policy.createdAt,
        revokedAt: policy.revokedAt,
        status: policyStatusAt(policy, now),
      })),
    };
  };
}
