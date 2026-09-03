import { createPostgresApplicationIdentityLookup } from "@capital-q/security/postgres";

import {
  createPostgresCreationRequestStore,
  createPostgresMembershipRepository,
  createPostgresOrganisationRepository,
  createPostgresRoleTemplateRepository,
  createPostgresTenantRepository,
} from "../infrastructure/postgres-repositories.js";
import {
  createActivateOrganisation,
  type ActivateOrganisationCommand,
  type ActivatedOrganisationContext,
} from "./activate-organisation.js";
import {
  createCreateOrganisation,
  type CreateOrganisationCommand,
} from "./create-organisation.js";
import type { OrganisationServiceDependencies } from "./dependencies.js";
import {
  createGetOrganisation,
  createListMyOrganisations,
  type GetOrganisationQuery,
  type ListMyOrganisationsQuery,
  type MembershipPage,
} from "./read-organisations.js";
import {
  createUpdateOrganisation,
  type UpdateOrganisationCommand,
} from "./update-organisation.js";
import type { MembershipView, Organisation } from "../domain/organisation.js";

/**
 * The organisation application service: the one entry point HTTP (and any
 * future worker or Q tool) calls. Routes stay thin -- authenticate, resolve
 * context, parse the contract, call one of these, map the result.
 */
export type OrganisationService = {
  readonly createOrganisation: (
    command: CreateOrganisationCommand,
  ) => Promise<MembershipView>;
  readonly listMyOrganisations: (
    query: ListMyOrganisationsQuery,
  ) => Promise<MembershipPage>;
  readonly getOrganisation: (
    query: GetOrganisationQuery,
  ) => Promise<Organisation>;
  readonly updateOrganisation: (
    command: UpdateOrganisationCommand,
  ) => Promise<Organisation>;
  readonly activateOrganisation: (
    command: ActivateOrganisationCommand,
  ) => Promise<ActivatedOrganisationContext>;
};

export type OrganisationServiceOptions = Omit<
  OrganisationServiceDependencies,
  "repositories" | "identities"
> & {
  readonly repositories?:
    OrganisationServiceDependencies["repositories"] | undefined;
  readonly identities?:
    OrganisationServiceDependencies["identities"] | undefined;
};

export function createOrganisationService(
  options: OrganisationServiceOptions,
): OrganisationService {
  const dependencies: OrganisationServiceDependencies = {
    ...options,
    identities:
      options.identities ??
      ((executor) =>
        createPostgresApplicationIdentityLookup({ sql: executor })),
    repositories: options.repositories ?? {
      tenants: createPostgresTenantRepository(),
      organisations: createPostgresOrganisationRepository(),
      memberships: createPostgresMembershipRepository(),
      roleTemplates: createPostgresRoleTemplateRepository(),
      creationRequests: createPostgresCreationRequestStore(),
    },
  };

  return {
    createOrganisation: createCreateOrganisation(dependencies),
    listMyOrganisations: createListMyOrganisations(dependencies),
    getOrganisation: createGetOrganisation(dependencies),
    updateOrganisation: createUpdateOrganisation(dependencies),
    activateOrganisation: createActivateOrganisation(dependencies),
  };
}
