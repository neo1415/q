/**
 * @capital-q/organisations
 *
 * Owns: the organisation bounded context -- tenant workspace bootstrap,
 * organisation profile, membership context, initial role assignment and
 * active organisation selection -- over the CQ-DATA-002 identity tables:
 * identity.tenants, organisations, tenant_organisations,
 * organisation_memberships, membership_roles, user_active_contexts, plus the
 * creation-idempotency record this packet adds.
 *
 * Does not own: persons (identity.user_profiles, auth.users), the permission
 * engine, companies, investor organisations, mandates, capital objectives,
 * invitations, verification or claiming. It consumes security, audit and
 * eventing through their existing ports and never publishes to a queue.
 *
 * Invariant kept in code and rows alike:
 *
 *   Person ≠ Organisation ≠ Membership ≠ Tenant ≠ Title ≠ Role ≠ Capability
 *
 * Server-side only. No HTTP framework, no React, no browser SDK here.
 */

export {
  toOrganisationDto,
  toOrganisationIdentity,
  type Membership,
  type MembershipView,
  type Organisation,
  type OrganisationIdentity,
} from "./domain/organisation.js";
export {
  organisationSlugFromDisplayName,
  SLUG_FALLBACK,
  SLUG_MAX_LENGTH,
} from "./domain/slug.js";
export {
  OrganisationCreationConflictError,
  OrganisationNotFoundError,
  OrganisationReferenceDataError,
  OrganisationVersionConflictError,
} from "./domain/errors.js";
export {
  hashCreateOrganisationRequest,
  hashIdempotencyKey,
} from "./domain/idempotency.js";
export {
  decodeMembershipCursor,
  encodeMembershipCursor,
  type MembershipCursor,
} from "./domain/cursor.js";

export type {
  CreationRequestRecord,
  MembershipRepository,
  NewOrganisation,
  OrganisationCreationRequestStore,
  OrganisationProfileChanges,
  OrganisationQueryPort,
  OrganisationRepository,
  RoleTemplateRepository,
  TenantRepository,
} from "./application/ports.js";
export type { OrganisationServiceDependencies } from "./application/dependencies.js";
export {
  createCreateOrganisation,
  INITIAL_ADMIN_ROLE_CODE,
  type CreateOrganisationCommand,
} from "./application/create-organisation.js";
export {
  createGetOrganisation,
  createListMyOrganisations,
  ORGANISATION_VIEW,
  type GetOrganisationQuery,
  type ListMyOrganisationsQuery,
  type MembershipPage,
} from "./application/read-organisations.js";
export {
  createUpdateOrganisation,
  ORGANISATION_ADMIN,
  type UpdateOrganisationCommand,
} from "./application/update-organisation.js";
export {
  createActivateOrganisation,
  type ActivateOrganisationCommand,
  type ActivatedOrganisationContext,
} from "./application/activate-organisation.js";
export {
  createOrganisationService,
  type OrganisationService,
  type OrganisationServiceOptions,
} from "./application/service.js";

export {
  createPostgresCreationRequestStore,
  createPostgresMembershipRepository,
  createPostgresOrganisationQueryPort,
  createPostgresOrganisationRepository,
  createPostgresRoleTemplateRepository,
  createPostgresTenantRepository,
} from "./infrastructure/postgres-repositories.js";

export const PACKAGE_NAME = "@capital-q/organisations" as const;
