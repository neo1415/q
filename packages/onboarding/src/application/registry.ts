import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";

import type { OnboardingWriteTargetKey } from "../definitions/schema.js";
import type {
  OnboardingStepContextProvider,
  OnboardingStepContextRegistry,
  OnboardingSubjectResolver,
  OnboardingSubjectResolverRegistry,
  OnboardingWriteTargetHandler,
  OnboardingWriteTargetRegistry,
} from "./ports.js";

/**
 * Registries are the seams through which owning domains plug into the
 * generic runtime. The runtime never interprets a target key or a subject
 * type itself; CQ-ONB-001 registers no Founder or Investor write handler.
 */

export function createOnboardingWriteTargetRegistry(
  handlers: readonly OnboardingWriteTargetHandler[] = [],
): OnboardingWriteTargetRegistry {
  const byKey = new Map<
    OnboardingWriteTargetKey,
    OnboardingWriteTargetHandler
  >();
  for (const handler of handlers) {
    if (byKey.has(handler.targetKey)) {
      throw new TypeError(
        `duplicate write target handler ${handler.targetKey}`,
      );
    }
    byKey.set(handler.targetKey, handler);
  }
  return {
    get: (targetKey) => byKey.get(targetKey),
    keys: () => [...byKey.keys()],
  };
}

export function createOnboardingStepContextRegistry(
  providers: readonly OnboardingStepContextProvider[] = [],
): OnboardingStepContextRegistry {
  const byKey = new Map<string, OnboardingStepContextProvider>();
  for (const provider of providers) {
    if (byKey.has(provider.key)) {
      throw new TypeError(`duplicate step context provider ${provider.key}`);
    }
    byKey.set(provider.key, provider);
  }
  return { get: (key) => byKey.get(key) };
}

export function createOnboardingSubjectResolverRegistry(
  resolvers: readonly OnboardingSubjectResolver[],
): OnboardingSubjectResolverRegistry {
  const byType = new Map<
    OnboardingSubjectResolver["subjectType"],
    OnboardingSubjectResolver
  >();
  for (const resolver of resolvers) {
    if (byType.has(resolver.subjectType)) {
      throw new TypeError(
        `duplicate subject resolver for ${resolver.subjectType}`,
      );
    }
    byType.set(resolver.subjectType, resolver);
  }
  return { get: (subjectType) => byType.get(subjectType) };
}

/**
 * COMPANY subject resolver over the Company public query port: the company
 * must exist in the actor's tenant and be owned by the actor's active
 * organisation. Identity resolution only; no Founder journey logic.
 */
export function createCompanyOnboardingSubjectResolver(
  companies: CompanyQueryPort,
): OnboardingSubjectResolver {
  return {
    subjectType: "COMPANY",
    resolve: async (context, subjectId) => {
      const id = CompanyIdSchema.safeParse(subjectId);
      if (!id.success || context.organisationId === undefined) {
        return null;
      }
      const company = await companies.getCanonicalCompany(
        context.tenantId,
        id.data,
      );
      if (
        company === null ||
        company.organisationId !== context.organisationId
      ) {
        return null;
      }
      return {
        tenantId: company.tenantId,
        organisationId: company.organisationId,
      };
    },
  };
}
