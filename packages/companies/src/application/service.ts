import type { Company } from "../contracts/index.js";
import {
  createPostgresCompanyCreationRequestStore,
  createPostgresCompanyRepository,
} from "../infrastructure/postgres-company-repository.js";
import {
  createCreateCompany,
  type CreateCompanyCommand,
} from "./create-company.js";
import type { CompanyServiceDependencies } from "./dependencies.js";
import { createGetCompany, type GetCompanyQuery } from "./get-company.js";
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
    },
  };

  return {
    createCompany: createCreateCompany(dependencies),
    getCompany: createGetCompany(dependencies),
    updateCompany: createUpdateCompany(dependencies),
  };
}
