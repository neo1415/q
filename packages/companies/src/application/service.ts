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

/**
 * The company application service: the one entry point HTTP (and later
 * onboarding, Q tools and workers) calls. Routes stay thin.
 */
export type CompanyService = {
  readonly createCompany: (command: CreateCompanyCommand) => Promise<Company>;
  readonly getCompany: (query: GetCompanyQuery) => Promise<Company>;
  readonly updateCompany: (command: UpdateCompanyCommand) => Promise<Company>;
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
  "repositories"
> & {
  readonly repositories?:
    CompanyServiceDependencies["repositories"] | undefined;
};

export function createCompanyService(
  options: CompanyServiceOptions,
): CompanyService {
  const dependencies: CompanyServiceDependencies = {
    ...options,
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
    getMyCompanyMembership: createGetMyCompanyMembership(dependencies),
    upsertMyCompanyMembership: createUpsertMyCompanyMembership(dependencies),
    getMyFounderProfile: createGetMyFounderProfile(dependencies),
    updateMyFounderProfile: createUpdateMyFounderProfile(dependencies),
    getCompanyTeamFacts: createGetCompanyTeamFacts(dependencies),
    updateCompanyTeamFacts: createUpdateCompanyTeamFacts(dependencies),
  };
}
