import type { MarketplaceReadinessAssessment } from "@capital-q/contracts";

import type { Company } from "../contracts/index.js";
import type {
  CompanyMember,
  CompanyTeamFacts,
  FounderProfile,
} from "../contracts/team.js";
import {
  createPostgresCompanyCreationRequestStore,
  createPostgresCompanyRepository,
} from "../infrastructure/postgres-company-repository.js";
import { createUnavailableVerificationClaimsPort } from "../infrastructure/unavailable-verification-claims.js";
import {
  createAssessMarketplaceReadiness,
  createGetMarketplaceReadiness,
  type AssessMarketplaceReadinessCommand,
  type GetMarketplaceReadinessQuery,
} from "./marketplace-readiness.js";
import {
  createPostgresCompanyMemberRepository,
  createPostgresCompanyTeamFactsRepository,
  createPostgresFounderProfileRepository,
} from "../infrastructure/postgres-team-repositories.js";
import {
  createCreateCompany,
  type CreateCompanyCommand,
} from "./create-company.js";
import type { CompanyServiceDependencies } from "./dependencies.js";
import { createGetCompany, type GetCompanyQuery } from "./get-company.js";
import {
  createGetCompanyTeamFacts,
  createGetMyCompanyMembership,
  createGetMyFounderProfile,
  createUpdateCompanyTeamFacts,
  createUpdateMyFounderProfile,
  createUpsertMyCompanyMembership,
  type GetCompanyTeamFactsQuery,
  type GetMyCompanyMembershipQuery,
  type GetMyFounderProfileQuery,
  type UpdateCompanyTeamFactsCommand,
  type UpdateMyFounderProfileCommand,
  type UpsertMyCompanyMembershipCommand,
} from "./team-use-cases.js";
import {
  createUpdateCompany,
  type UpdateCompanyCommand,
} from "./update-company.js";
import {
  createSetCompanyVisibility,
  type SetCompanyVisibilityCommand,
} from "./set-company-visibility.js";

/**
 * The company application service: the one entry point HTTP (and later
 * onboarding, Q tools and workers) calls. Routes stay thin.
 */
export type CompanyService = {
  readonly createCompany: (command: CreateCompanyCommand) => Promise<Company>;
  readonly getCompany: (query: GetCompanyQuery) => Promise<Company>;
  readonly updateCompany: (command: UpdateCompanyCommand) => Promise<Company>;
  /** Who may see the declared profile (CQ-PRE-REC-001 §31-§35). */
  readonly setCompanyVisibility: (
    command: SetCompanyVisibilityCommand,
  ) => Promise<Company>;
  /** Marketplace readiness as the policy sees it now; reads nothing but canonical state. */
  readonly getMarketplaceReadiness: (
    query: GetMarketplaceReadinessQuery,
  ) => Promise<MarketplaceReadinessAssessment>;
  /** Reconcile the stored readiness state with the policy (CQ-MKT-001). */
  readonly assessMarketplaceReadiness: (
    command: AssessMarketplaceReadinessCommand,
  ) => Promise<MarketplaceReadinessAssessment>;
  readonly getMyCompanyMembership: (
    query: GetMyCompanyMembershipQuery,
  ) => Promise<CompanyMember>;
  readonly upsertMyCompanyMembership: (
    command: UpsertMyCompanyMembershipCommand,
  ) => Promise<CompanyMember>;
  readonly getMyFounderProfile: (
    query: GetMyFounderProfileQuery,
  ) => Promise<FounderProfile>;
  readonly updateMyFounderProfile: (
    command: UpdateMyFounderProfileCommand,
  ) => Promise<FounderProfile>;
  readonly getCompanyTeamFacts: (
    query: GetCompanyTeamFactsQuery,
  ) => Promise<CompanyTeamFacts>;
  readonly updateCompanyTeamFacts: (
    command: UpdateCompanyTeamFactsCommand,
  ) => Promise<CompanyTeamFacts>;
};

export type CompanyServiceOptions = Omit<
  CompanyServiceDependencies,
  "repositories" | "verification"
> & {
  readonly repositories?:
    CompanyServiceDependencies["repositories"] | undefined;
  /**
   * Omitted in every application: the production seam answers
   * "unavailable" until a Verification context exists. Supplied only by
   * tests and the local synthetic fixture.
   */
  readonly verification?:
    CompanyServiceDependencies["verification"] | undefined;
};

export function createCompanyService(
  options: CompanyServiceOptions,
): CompanyService {
  const dependencies: CompanyServiceDependencies = {
    ...options,
    verification:
      options.verification ?? createUnavailableVerificationClaimsPort(),
    repositories: options.repositories ?? {
      companies: createPostgresCompanyRepository(),
      creationRequests: createPostgresCompanyCreationRequestStore(),
      members: createPostgresCompanyMemberRepository(),
      founderProfiles: createPostgresFounderProfileRepository(),
      teamFacts: createPostgresCompanyTeamFactsRepository(),
    },
  };

  return {
    createCompany: createCreateCompany(dependencies),
    getCompany: createGetCompany(dependencies),
    updateCompany: createUpdateCompany(dependencies),
    setCompanyVisibility: createSetCompanyVisibility(dependencies),
    getMarketplaceReadiness: createGetMarketplaceReadiness(dependencies),
    assessMarketplaceReadiness: createAssessMarketplaceReadiness(dependencies),
    getMyCompanyMembership: createGetMyCompanyMembership(dependencies),
    upsertMyCompanyMembership: createUpsertMyCompanyMembership(dependencies),
    getMyFounderProfile: createGetMyFounderProfile(dependencies),
    updateMyFounderProfile: createUpdateMyFounderProfile(dependencies),
    getCompanyTeamFacts: createGetCompanyTeamFacts(dependencies),
    updateCompanyTeamFacts: createUpdateCompanyTeamFacts(dependencies),
  };
}
