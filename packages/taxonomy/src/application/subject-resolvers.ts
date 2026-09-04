import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";

import type { TaxonomySubjectType } from "../contracts/index.js";
import type { TaxonomySubjectResolver } from "./ports.js";

/**
 * COMPANY subject resolver over the Company public query port. Tenant
 * comes from the ActorContext; the company must be visible in that tenant
 * (enumeration-safe otherwise). No SQL, no table name.
 */
export function createCompanyTaxonomySubjectResolver(
  companies: CompanyQueryPort,
): TaxonomySubjectResolver {
  return {
    subjectType: "COMPANY",
    resolve: async (tenantId, subjectId) => {
      const id = CompanyIdSchema.safeParse(subjectId);
      if (!id.success) {
        return null;
      }
      const company = await companies.getCanonicalCompany(tenantId, id.data);
      if (company === null) {
        return null;
      }
      return {
        subjectType: "COMPANY",
        subjectId: company.id,
        tenantId: company.tenantId,
        organisationId: company.organisationId,
      };
    },
  };
}

export type TaxonomySubjectResolverRegistry = {
  readonly resolve: (
    subjectType: TaxonomySubjectType,
    tenantId: Parameters<TaxonomySubjectResolver["resolve"]>[0],
    subjectId: string,
  ) => ReturnType<TaxonomySubjectResolver["resolve"]>;
};

export function createTaxonomySubjectResolverRegistry(
  resolvers: readonly TaxonomySubjectResolver[],
): TaxonomySubjectResolverRegistry {
  const byType = new Map<TaxonomySubjectType, TaxonomySubjectResolver>();
  for (const resolver of resolvers) {
    if (byType.has(resolver.subjectType)) {
      throw new TypeError(
        `duplicate subject resolver for ${resolver.subjectType}`,
      );
    }
    byType.set(resolver.subjectType, resolver);
  }
  return {
    resolve: async (subjectType, tenantId, subjectId) => {
      const resolver = byType.get(subjectType);
      return resolver === undefined
        ? null
        : resolver.resolve(tenantId, subjectId);
    },
  };
}
