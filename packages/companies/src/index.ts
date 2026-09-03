/**
 * @capital-q/companies
 *
 * Owns: the canonical Company -- one per represented business -- over
 * core.companies: identity, profile core (names, website, founded date,
 * headquarters), stage reference, descriptions, baseline lifecycle and the
 * locked-down marketplace visibility/readiness fields.
 *
 * Does not own: founders and team (CQ-COMP-002), business models, metrics
 * and milestones, taxonomy assignments, the capital objective (CQ-CAP-001),
 * evidence and verification, marketplace activation, recommendations, feed
 * projections or Q. It reaches the organisation only through its public
 * query port and never publishes to a queue.
 *
 *   Company ≠ Organisation ≠ Person ≠ Capital Objective ≠ Score
 *
 * Server-side only. Browser consumers use the wire DTOs in
 * @capital-q/contracts and the typed API client.
 */

export {
  CompanyIdSchema,
  toCompanyDto,
  toCompanyIdentity,
  type Company,
  type CompanyId,
  type CompanyIdentity,
} from "./contracts/index.js";
export {
  CompanyCreationConflictError,
  CompanyNotFoundError,
  CompanySlugUnavailableError,
  CompanyVersionConflictError,
} from "./domain/errors.js";
export {
  COMPANY_SLUG_FALLBACK,
  COMPANY_SLUG_MAX_LENGTH,
  COMPANY_SLUG_MAX_SUFFIX,
  companySlugCandidates,
  companySlugFromName,
} from "./domain/slug.js";
export {
  hashCompanyIdempotencyKey,
  hashCreateCompanyRequest,
} from "./domain/idempotency.js";

export type {
  CompanyCreationRecord,
  CompanyCreationRequestStore,
  CompanyProfileChanges,
  CompanyQueryPort,
  CompanyRepository,
  CompanyVisibilityFacts,
  FounderProfileOwnershipFacts,
  NewCompany,
} from "./application/ports.js";
export type { CompanyServiceDependencies } from "./application/dependencies.js";
export {
  COMPANY_CREATE,
  createCreateCompany,
  type CreateCompanyCommand,
} from "./application/create-company.js";
export {
  COMPANY_VIEW,
  createGetCompany,
  type GetCompanyQuery,
} from "./application/get-company.js";
export {
  COMPANY_EDIT,
  createUpdateCompany,
  type UpdateCompanyCommand,
} from "./application/update-company.js";
export {
  createCompanyService,
  type CompanyService,
  type CompanyServiceOptions,
} from "./application/service.js";

export {
  createPostgresCompanyCreationRequestStore,
  createPostgresCompanyQueryPort,
  createPostgresCompanyRepository,
} from "./infrastructure/postgres-company-repository.js";

export {
  CompanyMemberIdSchema,
  FounderProfileIdSchema,
  toCompanyMemberDto,
  toCompanyTeamFactsDto,
  toFounderProfileDto,
  type CompanyMember,
  type CompanyMemberId,
  type CompanyTeamFacts,
  type FounderProfile,
  type FounderProfileId,
} from "./contracts/team.js";
export {
  CompanyMemberNotFoundError,
  CompanyTeamFactsNotFoundError,
  FounderProfileNotAllowedError,
  FounderProfileNotFoundError,
  TeamVersionConflictError,
} from "./domain/team-errors.js";
export type {
  CompanyMemberChanges,
  CompanyMemberRepository,
  CompanyTeamFactsRepository,
  CompanyTeamFactsValues,
  FounderProfileChanges,
  FounderProfileRepository,
} from "./application/team-ports.js";
export {
  COMPANY_TEAM_MANAGE,
  COMPANY_TEAM_SELF_EDIT,
  COMPANY_TEAM_VIEW,
  type GetCompanyTeamFactsQuery,
  type GetMyCompanyMembershipQuery,
  type GetMyFounderProfileQuery,
  type UpdateCompanyTeamFactsCommand,
  type UpdateMyFounderProfileCommand,
  type UpsertMyCompanyMembershipCommand,
} from "./application/team-use-cases.js";
export {
  createPostgresCompanyMemberRepository,
  createPostgresCompanyTeamFactsRepository,
  createPostgresFounderProfileRepository,
} from "./infrastructure/postgres-team-repositories.js";

export const PACKAGE_NAME = "@capital-q/companies" as const;
