import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
} from "@capital-q/security";

import type { MediaOwnerRef, MediaOwnerType } from "../contracts/index.js";

/**
 * Typed owner resolution.
 *
 * A media asset names its owner as `{ ownerType, ownerId }`, and the only
 * way to turn that pair into a trusted fact is a resolver registered for
 * that type over the owning domain's public query port. There is no
 * `select from ${ownerType}` and no owner type this build does not know:
 * an unregistered type resolves to nothing rather than to a guess.
 *
 * Tenancy comes from the resolved row, never from the caller. A request may
 * name a company; it may not tell us whose company it is.
 */

export type ResolvedMediaOwner = {
  readonly ownerType: MediaOwnerType;
  readonly ownerId: string;
  readonly tenantId: TenantId;
  readonly ownerOrganisationId: OrganisationId;
};

export type MediaOwnerResolver = {
  readonly ownerType: MediaOwnerType;
  /**
   * The owner as visible in the actor's tenant, or null. An owner that
   * exists in another tenant is null, identically to a missing one.
   */
  readonly resolve: (
    actor: ActorContext,
    ownerId: string,
  ) => Promise<ResolvedMediaOwner | null>;
};

export type MediaOwnerResolverRegistry = {
  readonly get: (ownerType: MediaOwnerType) => MediaOwnerResolver | undefined;
  readonly resolve: (
    actor: ActorContext,
    ref: MediaOwnerRef,
  ) => Promise<ResolvedMediaOwner | null>;
};

export function createMediaOwnerResolverRegistry(
  resolvers: readonly MediaOwnerResolver[],
): MediaOwnerResolverRegistry {
  const byType = new Map<MediaOwnerType, MediaOwnerResolver>();
  for (const resolver of resolvers) {
    if (byType.has(resolver.ownerType)) {
      throw new TypeError(
        `duplicate media owner resolver for ${resolver.ownerType}`,
      );
    }
    byType.set(resolver.ownerType, resolver);
  }
  return {
    get: (ownerType) => byType.get(ownerType),
    resolve: async (actor, ref) => {
      const resolver = byType.get(ref.ownerType);
      if (resolver === undefined) {
        return null;
      }
      return resolver.resolve(actor, ref.ownerId);
    },
  };
}

/** COMPANY owners resolve through the Company public query port only. */
export function createCompanyMediaOwnerResolver(
  companies: CompanyQueryPort,
): MediaOwnerResolver {
  return {
    ownerType: "COMPANY",
    resolve: async (actor, ownerId) => {
      const parsed = CompanyIdSchema.safeParse(ownerId);
      if (!parsed.success) {
        return null;
      }
      const company = await companies.getCanonicalCompany(
        actor.tenantId,
        parsed.data,
      );
      if (company === null) {
        return null;
      }
      return {
        ownerType: "COMPANY",
        ownerId: company.id,
        tenantId: company.tenantId,
        ownerOrganisationId: company.organisationId,
      };
    },
  };
}
