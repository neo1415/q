import { capability, type ActorContext } from "@capital-q/security";

import type { MediaOwnerRef } from "../contracts/index.js";
import { MediaOwnerNotFoundError } from "../domain/errors.js";
import type { ResolvedMediaOwner } from "../domain/owners.js";
import type { MediaServiceDependencies } from "./dependencies.js";

/**
 * Media authority.
 *
 * `media.create` covers publishing and replacing a pitch, which a founder
 * does routinely. `media.manage` covers removing one, which is
 * consequential: a deleted pitch changes what a company presents and what
 * later projections can show. `media.view` reads metadata and grants no
 * playback — playback is authorised separately, against the viewer, the
 * disclosure decision and the asset's own policy.
 *
 * None of these is granted by being a founder or by holding a title.
 */
export const MEDIA_CREATE = capability("media.create");
export const MEDIA_VIEW = capability("media.view");
export const MEDIA_MANAGE = capability("media.manage");

export type ActiveOrganisationId = NonNullable<ActorContext["organisationId"]>;

export function activeOrganisation(actor: ActorContext): ActiveOrganisationId {
  if (actor.organisationId === undefined) {
    throw new MediaOwnerNotFoundError();
  }
  return actor.organisationId;
}

/**
 * The owner as the actor may know it: it must resolve in the actor's tenant
 * and belong to the actor's active organisation. Anything else is "not
 * found", before any authorization detail could differ — a valid company id
 * from another tenant must be indistinguishable from a typo.
 */
export async function ownedResource(
  dependencies: MediaServiceDependencies,
  actor: ActorContext,
  ref: MediaOwnerRef,
): Promise<ResolvedMediaOwner> {
  const organisationId = activeOrganisation(actor);
  const owner = await dependencies.owners.resolve(actor, ref);
  if (
    owner === null ||
    owner.tenantId !== actor.tenantId ||
    owner.ownerOrganisationId !== organisationId
  ) {
    throw new MediaOwnerNotFoundError();
  }
  return owner;
}

/** Media authority is scoped to the exact organisation that owns the resource. */
export function ownerScope(actor: ActorContext, owner: ResolvedMediaOwner) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId: owner.ownerOrganisationId,
    resourceType: owner.ownerType.toLowerCase(),
    resourceId: owner.ownerId,
  };
}
