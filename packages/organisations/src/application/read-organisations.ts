import { DEFAULT_PAGE_SIZE } from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  capability,
  type ActorContext,
  type AuthenticatedPrincipal,
  type OrganisationId,
} from "@capital-q/security";

import {
  decodeMembershipCursor,
  encodeMembershipCursor,
} from "../domain/cursor.js";
import { OrganisationNotFoundError } from "../domain/errors.js";
import type { MembershipView, Organisation } from "../domain/organisation.js";
import type { OrganisationServiceDependencies } from "./dependencies.js";

export const ORGANISATION_VIEW = capability("organisation.view");

export type ListMyOrganisationsQuery = {
  readonly principal: AuthenticatedPrincipal;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

export type MembershipPage = {
  readonly items: readonly MembershipView[];
  readonly nextCursor: string | undefined;
};

/**
 * The organisations the authenticated Person currently holds an active
 * membership in. Person-scoped: it works with no organisation context and
 * derives everything from the session -- there is no way to ask for someone
 * else's list.
 */
export function createListMyOrganisations(
  dependencies: OrganisationServiceDependencies,
) {
  const { sql, identities, repositories } = dependencies;

  return async (query: ListMyOrganisationsQuery): Promise<MembershipPage> => {
    const identity = await identities(sql).lookup(query.principal);
    if (identity === null) {
      throw new ActorContextDeniedError();
    }

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const after =
      query.cursor === undefined
        ? undefined
        : decodeMembershipCursor(query.cursor);

    // One more than the page so the end of the set is known without a count.
    const rows = await repositories.memberships.listActiveForUser(
      sql,
      identity.userId,
      { after, limit: limit + 1 },
    );

    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last !== undefined
        ? encodeMembershipCursor({
            joinedAt: last.membership.joinedAt,
            id: last.membership.id,
          })
        : undefined;

    return { items, nextCursor };
  };
}

export type GetOrganisationQuery = {
  /** Trusted: server-resolved for this request. */
  readonly actor: ActorContext;
  /** Untrusted: the path parameter. */
  readonly organisationId: OrganisationId;
};

/**
 * Detailed read of the caller's current organisation.
 *
 * V1 rule: the requested organisation must be the resolved active context.
 * Any other identifier -- another tenant's, a former membership's, one that
 * does not exist -- is answered identically with "not found", before
 * authorization runs, so a guessed UUID learns nothing. Then
 * `organisation.view` is required over the exact organisation scope.
 */
export function createGetOrganisation(
  dependencies: OrganisationServiceDependencies,
) {
  const { sql, authorization, repositories } = dependencies;

  return async (query: GetOrganisationQuery): Promise<Organisation> => {
    const { actor } = query;
    if (
      actor.organisationId === undefined ||
      actor.organisationId !== query.organisationId
    ) {
      throw new OrganisationNotFoundError();
    }

    await authorization.requireCapability({
      actor,
      capability: ORGANISATION_VIEW,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
      },
    });

    const organisation = await repositories.organisations.findById(
      sql,
      actor.tenantId,
      actor.organisationId,
    );
    if (organisation === null) {
      throw new OrganisationNotFoundError();
    }
    return organisation;
  };
}
