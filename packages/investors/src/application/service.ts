import type {
  InvestorOrganisation,
  InvestorRepresentative,
} from "../contracts/index.js";
import type { InvestorMandate } from "../contracts/mandate.js";
import {
  createPostgresInvestorMandateCreationRequestStore,
  createPostgresInvestorMandateRepository,
} from "../infrastructure/postgres-mandate-repository.js";
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
  createActivateInvestorMandate,
  createCloseInvestorMandate,
  createCreateInvestorMandate,
  createGetInvestorMandate,
  createListInvestorMandates,
  createUpdateInvestorMandate,
  type CreateInvestorMandateCommand,
  type GetInvestorMandateQuery,
  type InvestorMandatePage,
  type ListInvestorMandatesQuery,
  type TransitionInvestorMandateCommand,
  type UpdateInvestorMandateCommand,
} from "./mandate-use-cases.js";
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
  readonly createInvestorMandate: (
    command: CreateInvestorMandateCommand,
  ) => Promise<InvestorMandate>;
  readonly getInvestorMandate: (
    query: GetInvestorMandateQuery,
  ) => Promise<InvestorMandate>;
  readonly listInvestorMandates: (
    query: ListInvestorMandatesQuery,
  ) => Promise<InvestorMandatePage>;
  readonly updateInvestorMandate: (
    command: UpdateInvestorMandateCommand,
  ) => Promise<InvestorMandate>;
  readonly activateInvestorMandate: (
    command: TransitionInvestorMandateCommand,
  ) => Promise<InvestorMandate>;
  readonly closeInvestorMandate: (
    command: TransitionInvestorMandateCommand,
  ) => Promise<InvestorMandate>;
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
      mandates: createPostgresInvestorMandateRepository(),
      mandateCreationRequests:
        createPostgresInvestorMandateCreationRequestStore(),
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
    createInvestorMandate: createCreateInvestorMandate(dependencies),
    getInvestorMandate: createGetInvestorMandate(dependencies),
    listInvestorMandates: createListInvestorMandates(dependencies),
    updateInvestorMandate: createUpdateInvestorMandate(dependencies),
    activateInvestorMandate: createActivateInvestorMandate(dependencies),
    closeInvestorMandate: createCloseInvestorMandate(dependencies),
  };
}
