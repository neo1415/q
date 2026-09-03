import type {
  InvestorOrganisation,
  InvestorRepresentative,
} from "../contracts/index.js";
import {
  createPostgresInvestorCreationRequestStore,
  createPostgresInvestorOrganisationRepository,
  createPostgresInvestorRepresentativeRepository,
} from "../infrastructure/postgres-repositories.js";
import {
  createCreateInvestorOrganisation,
  type CreateInvestorOrganisationCommand,
} from "./create-investor-organisation.js";
import type { InvestorServiceDependencies } from "./dependencies.js";
import {
  createGetCurrentInvestorOrganisation,
  createGetInvestorOrganisation,
  type GetCurrentInvestorOrganisationQuery,
  type GetInvestorOrganisationQuery,
} from "./read-investor-organisation.js";
import {
  createGetMyInvestorRepresentative,
  createUpsertMyInvestorRepresentative,
  type GetMyInvestorRepresentativeQuery,
  type UpsertMyInvestorRepresentativeCommand,
} from "./representative-use-cases.js";
import {
  createUpdateInvestorOrganisation,
  type UpdateInvestorOrganisationCommand,
} from "./update-investor-organisation.js";

/**
 * The investor application service: the one entry point HTTP (and later
 * investor onboarding, Q tools and workers) calls. Routes stay thin.
 */
export type InvestorService = {
  readonly createInvestorOrganisation: (
    command: CreateInvestorOrganisationCommand,
  ) => Promise<InvestorOrganisation>;
  readonly getInvestorOrganisation: (
    query: GetInvestorOrganisationQuery,
  ) => Promise<InvestorOrganisation>;
  readonly getCurrentInvestorOrganisation: (
    query: GetCurrentInvestorOrganisationQuery,
  ) => Promise<InvestorOrganisation>;
  readonly updateInvestorOrganisation: (
    command: UpdateInvestorOrganisationCommand,
  ) => Promise<InvestorOrganisation>;
  readonly getMyInvestorRepresentative: (
    query: GetMyInvestorRepresentativeQuery,
  ) => Promise<InvestorRepresentative>;
  readonly upsertMyInvestorRepresentative: (
    command: UpsertMyInvestorRepresentativeCommand,
  ) => Promise<InvestorRepresentative>;
};

export type InvestorServiceOptions = Omit<
  InvestorServiceDependencies,
  "repositories"
> & {
  readonly repositories?:
    InvestorServiceDependencies["repositories"] | undefined;
};

export function createInvestorService(
  options: InvestorServiceOptions,
): InvestorService {
  const dependencies: InvestorServiceDependencies = {
    ...options,
    repositories: options.repositories ?? {
      investors: createPostgresInvestorOrganisationRepository(),
      representatives: createPostgresInvestorRepresentativeRepository(),
      creationRequests: createPostgresInvestorCreationRequestStore(),
    },
  };

  return {
    createInvestorOrganisation: createCreateInvestorOrganisation(dependencies),
    getInvestorOrganisation: createGetInvestorOrganisation(dependencies),
    getCurrentInvestorOrganisation:
      createGetCurrentInvestorOrganisation(dependencies),
    updateInvestorOrganisation: createUpdateInvestorOrganisation(dependencies),
    getMyInvestorRepresentative:
      createGetMyInvestorRepresentative(dependencies),
    upsertMyInvestorRepresentative:
      createUpsertMyInvestorRepresentative(dependencies),
  };
}
