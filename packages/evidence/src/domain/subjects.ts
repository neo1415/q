import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
} from "@capital-q/security";

import type {
  EvidenceSubjectRef,
  EvidenceSubjectType,
} from "../contracts/index.js";

/**
 * Typed subject resolution. A subject reference is `{ subjectType,
 * subjectId }`; the only way to turn it into a trusted fact is a resolver
 * registered for that type over the owning domain's public query port.
 * There is no `select from ${subjectType}` anywhere.
 */

export type ResolvedEvidenceSubject = {
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly tenantId: TenantId;
  /** The organisation that owns the subject. */
  readonly ownerOrganisationId: OrganisationId;
};

export type EvidenceSubjectResolver = {
  readonly subjectType: EvidenceSubjectType;
  /**
   * The subject as visible in the actor's tenant, or null. A subject that
   * exists in another tenant is null, identically to a missing one.
   */
  readonly resolve: (
    actor: ActorContext,
    subjectId: string,
  ) => Promise<ResolvedEvidenceSubject | null>;
};

export type EvidenceSubjectResolverRegistry = {
  readonly get: (
    subjectType: EvidenceSubjectType,
  ) => EvidenceSubjectResolver | undefined;
  readonly resolve: (
    actor: ActorContext,
    ref: EvidenceSubjectRef,
  ) => Promise<ResolvedEvidenceSubject | null>;
};

export function createEvidenceSubjectResolverRegistry(
  resolvers: readonly EvidenceSubjectResolver[],
): EvidenceSubjectResolverRegistry {
  const byType = new Map<EvidenceSubjectType, EvidenceSubjectResolver>();
  for (const resolver of resolvers) {
    if (byType.has(resolver.subjectType)) {
      throw new TypeError(
        `duplicate evidence subject resolver for ${resolver.subjectType}`,
      );
    }
    byType.set(resolver.subjectType, resolver);
  }
  return {
    get: (subjectType) => byType.get(subjectType),
    resolve: async (actor, ref) => {
      const resolver = byType.get(ref.subjectType);
      if (resolver === undefined) {
        return null;
      }
      return resolver.resolve(actor, ref.subjectId);
    },
  };
}

/** COMPANY subjects resolve through the Company public query port only. */
export function createCompanyEvidenceSubjectResolver(
  companies: CompanyQueryPort,
): EvidenceSubjectResolver {
  return {
    subjectType: "COMPANY",
    resolve: async (actor, subjectId) => {
      const parsed = CompanyIdSchema.safeParse(subjectId);
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
        subjectType: "COMPANY",
        subjectId: company.id,
        tenantId: company.tenantId,
        ownerOrganisationId: company.organisationId,
      };
    },
  };
}
