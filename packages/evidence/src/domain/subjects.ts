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

/**
 * The port a PERSON subject resolves through. Deliberately minimal: a
 * person is a subject of evidence only as a member of the acting
 * organisation, and only the acting person themselves. Evidence about
 * somebody else's public presence is not something this packet collects,
 * and a port that cannot express it cannot be asked for it.
 */
export type PersonSubjectQueryPort = {
  readonly isSelf: (actor: ActorContext, userId: string) => Promise<boolean>;
};

export function createPersonEvidenceSubjectResolver(
  people: PersonSubjectQueryPort,
): EvidenceSubjectResolver {
  return {
    subjectType: "PERSON",
    resolve: async (actor, subjectId) => {
      const organisationId = actor.organisationId;
      if (organisationId === undefined) {
        return null;
      }
      if (!(await people.isSelf(actor, subjectId))) {
        return null;
      }
      return {
        subjectType: "PERSON",
        subjectId,
        tenantId: actor.tenantId,
        ownerOrganisationId: organisationId,
      };
    },
  };
}

/** The port an INVESTOR_ORGANISATION subject resolves through. */
export type InvestorSubjectQueryPort = {
  readonly getInvestorOrganisationIdentity: (
    tenantId: TenantId,
    investorOrganisationId: string,
  ) => Promise<{
    readonly id: string;
    readonly tenantId: TenantId;
    readonly organisationId: OrganisationId;
  } | null>;
};

export function createInvestorEvidenceSubjectResolver(
  investors: InvestorSubjectQueryPort,
): EvidenceSubjectResolver {
  return {
    subjectType: "INVESTOR_ORGANISATION",
    resolve: async (actor, subjectId) => {
      const investor = await investors.getInvestorOrganisationIdentity(
        actor.tenantId,
        subjectId,
      );
      if (investor === null) {
        return null;
      }
      return {
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: investor.id,
        tenantId: investor.tenantId,
        ownerOrganisationId: investor.organisationId,
      };
    },
  };
}
