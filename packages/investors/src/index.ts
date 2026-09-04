/**
 * @capital-q/investors
 *
 * Owns: the canonical Investor Organisation -- one per represented capital
 * provider -- over core.investor_organisations: investing profile, investor
 * type, deployment state and the coarse verification presentation state;
 * plus core.investor_representatives, the attributable link from a Person,
 * in the capacity of a real organisation membership, to that investor.
 *
 * Does not own: persons, organisations or memberships (identity),
 * investment fund vehicles, declared mandates (CQ-INV-002), discovery
 * profiles, portfolio references, observed behaviour, Q inference, GateQ
 * rules, recommendations, relationships or the public investor profile.
 * It reaches the organisation only through its public query port and
 * never publishes to a queue. Zero LLM calls.
 *
 *   Person ≠ Organisation ≠ Membership ≠ InvestorOrganisation
 *   ≠ InvestorRepresentative ≠ Fund ≠ Mandate ≠ Authority
 *
 * Server-side only. Browser consumers use the wire DTOs in
 * @capital-q/contracts and the typed API client.
 */

export {
  InvestorOrganisationIdSchema,
  InvestorRepresentativeIdSchema,
  toInvestorOrganisationDto,
  toInvestorOrganisationIdentity,
  toInvestorRepresentativeDto,
  type InvestorOrganisation,
  type InvestorOrganisationId,
  type InvestorOrganisationIdentity,
  type InvestorRepresentative,
  type InvestorRepresentativeId,
} from "./contracts/index.js";
export {
  InvestorCreationConflictError,
  InvestorOrganisationExistsError,
  InvestorOrganisationNotFoundError,
  InvestorRepresentativeNotFoundError,
  InvestorVersionConflictError,
} from "./domain/errors.js";
export {
  hashCreateInvestorOrganisationRequest,
  hashInvestorIdempotencyKey,
} from "./domain/idempotency.js";

export type {
  InvestorCreationRecord,
  InvestorCreationRequestStore,
  InvestorOrganisationQueryPort,
  InvestorOrganisationRepository,
  InvestorProfileChanges,
  InvestorRepresentativeChanges,
  InvestorRepresentativeRepository,
  NewInvestorOrganisation,
} from "./application/ports.js";
export type { InvestorServiceDependencies } from "./application/dependencies.js";
export {
  createCreateInvestorOrganisation,
  INVESTOR_CREATE,
  type CreateInvestorOrganisationCommand,
} from "./application/create-investor-organisation.js";
export {
  createGetCurrentInvestorOrganisation,
  createGetInvestorOrganisation,
  INVESTOR_VIEW,
  type GetCurrentInvestorOrganisationQuery,
  type GetInvestorOrganisationQuery,
} from "./application/read-investor-organisation.js";
export {
  createUpdateInvestorOrganisation,
  INVESTOR_EDIT,
  type UpdateInvestorOrganisationCommand,
} from "./application/update-investor-organisation.js";
export {
  createGetMyInvestorRepresentative,
  createUpsertMyInvestorRepresentative,
  INVESTOR_REPRESENTATIVE_SELF_EDIT,
  type GetMyInvestorRepresentativeQuery,
  type UpsertMyInvestorRepresentativeCommand,
} from "./application/representative-use-cases.js";
export {
  createInvestorService,
  type InvestorService,
  type InvestorServiceOptions,
} from "./application/service.js";

export {
  createPostgresInvestorCreationRequestStore,
  createPostgresInvestorOrganisationQueryPort,
  createPostgresInvestorOrganisationRepository,
  createPostgresInvestorRepresentativeRepository,
} from "./infrastructure/postgres-repositories.js";

// Declared mandate (CQ-INV-002).
export {
  chequeRangeOf,
  InvestorMandateConstraintIdSchema,
  InvestorMandateIdSchema,
  toInvestorMandateConstraintDto,
  toInvestorMandateDto,
  toInvestorMandateSummaryDto,
  typicalCheque,
  type InvestorMandate,
  type InvestorMandateConstraint,
  type InvestorMandateConstraintId,
  type InvestorMandateId,
  type InvestorMandateSnapshot,
  type InvestorMandateSummary,
  type MandateAutomatedUse,
} from "./contracts/mandate.js";
export {
  InvestorMandateCreationConflictError,
  InvestorMandateLifecycleError,
  InvestorMandateNotFoundError,
} from "./domain/mandate-errors.js";
export { compareDecimalStrings } from "./domain/decimal.js";
export {
  automatedUseOf,
  BUSINESS_ATTRIBUTE_CODES,
  FOUNDER_BUSINESS_ATTRIBUTE_CODES,
  GREEN_FLAG_CODES,
  INVESTMENT_ROLE_CODES,
  MANDATE_CONSTRAINT_REGISTRY,
  validateChequeRange,
  validateMandateConstraints,
  type MandateConstraintDefinition,
} from "./domain/mandate-registry.js";
export {
  hashCreateInvestorMandateRequest,
  hashInvestorMandateIdempotencyKey,
} from "./domain/mandate-idempotency.js";
export type {
  InvestorMandateCreationRecord,
  InvestorMandateCreationRequestStore,
  InvestorMandateOwnershipFacts,
  InvestorMandateQueryPort,
  InvestorMandateRepository,
  InvestorMandateScalarChanges,
  MandateListPage,
  NewInvestorMandate,
  NewMandateConstraint,
} from "./application/mandate-ports.js";
export {
  createActivateInvestorMandate,
  createCloseInvestorMandate,
  createCreateInvestorMandate,
  createGetInvestorMandate,
  createListInvestorMandates,
  createUpdateInvestorMandate,
  INVESTOR_MANDATE_CREATE,
  INVESTOR_MANDATE_EDIT,
  INVESTOR_MANDATE_VIEW,
  type CreateInvestorMandateCommand,
  type GetInvestorMandateQuery,
  type InvestorMandatePage,
  type ListInvestorMandatesQuery,
  type TransitionInvestorMandateCommand,
  type UpdateInvestorMandateCommand,
} from "./application/mandate-use-cases.js";
export {
  createPostgresInvestorMandateCreationRequestStore,
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorMandateRepository,
} from "./infrastructure/postgres-mandate-repository.js";

// Portfolio references (CQ-ONB-003, ADR 0007).
export {
  InvestorPortfolioReferenceIdSchema,
  toInvestorPortfolioReferenceDto,
  type InvestorPortfolioReference,
  type InvestorPortfolioReferenceId,
} from "./contracts/portfolio.js";
export { InvestorPortfolioReferenceNotFoundError } from "./domain/errors.js";
export type {
  InvestorPortfolioReferenceRepository,
  NewInvestorPortfolioReference,
} from "./application/portfolio-ports.js";
export {
  createAddInvestorPortfolioReference,
  createListInvestorPortfolioReferences,
  createRemoveInvestorPortfolioReference,
  INVESTOR_PORTFOLIO_REFERENCES_MAX,
  type AddInvestorPortfolioReferenceCommand,
  type ListInvestorPortfolioReferencesQuery,
  type RemoveInvestorPortfolioReferenceCommand,
} from "./application/portfolio-use-cases.js";
export { createPostgresInvestorPortfolioReferenceRepository } from "./infrastructure/postgres-portfolio-repository.js";

export const PACKAGE_NAME = "@capital-q/investors" as const;
