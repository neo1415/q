/**
 * @capital-q/verification
 *
 * Owns: Capital Q's claim-specific verification record
 * (`evidence.verification_claims`, CQ-VERIFY-001): a founder's request that
 * a founder's identity and the organisation be verified, Capital Q's
 * decision on it and how that decision was made, and the standings the
 * Companies readiness policy reads.
 *
 * Does not own: evidence, truth class, evidence status or lifecycle
 * status (ADR-001 keeps verification a separate workflow), companies,
 * readiness itself, or any operator principal. No LLM anywhere.
 *
 *   Verification ≠ Evidence ≠ Endorsement ≠ Q inference
 *
 * Two decision methods exist. SYNTHETIC_DEMO_ATTESTATION decides only
 * where the deployment holds the synthetic-demo allowance and the people
 * involved are synthetic. OPERATOR_DECISION is a Capital Q operator's
 * decision from the admin console (ADR 0033); who may make it is decided
 * by @capital-q/platform-admin before the decider is reached.
 *
 * Server-side only.
 */

export {
  describeStanding,
  founderIdentityOf,
  isRequestable,
  organisationIdentityOf,
  personClaimTypeFor,
  standingOf,
  METHOD_PROVIDERS,
  SUBJECT_TYPE_OF,
  VERIFICATION_PROVIDER_CODES,
  type VerificationClaim,
  type VerificationProviderCode,
} from "./domain/claims.js";
export {
  decisionBasisOf,
  deploymentRefusal,
  type SyntheticDecisionRefusal,
  type SyntheticDemoAttestation,
} from "./domain/attestation.js";
export {
  SYNTHETIC_AUTO_VERIFY_POLICY,
  syntheticAutoVerifyAttestation,
} from "./domain/auto-verify-policy.js";
export {
  createSyntheticAutoVerifySweep,
  type SyntheticAutoVerifySweepResult,
} from "./application/auto-verify-sweep.js";
export type {
  NewOperatorDecision,
  NewPendingClaim,
  NewSyntheticDecision,
  PendingSyntheticClaimSource,
  SyntheticPrincipalPort,
  SyntheticReviewerScopePort,
  VerificationClaimRepository,
} from "./application/ports.js";
export {
  COMPANY_EDIT,
  toCompanyVerification,
  VERIFICATION_REQUEST,
  VERIFICATION_VIEW,
  type GetCompanyVerificationQuery,
  type RequestCompanyVerificationCommand,
  type RequestCompanyVerificationResult,
} from "./application/company-verification.js";
export {
  createAutoVerificationRequester,
  createAutoVerificationSweep,
  createPostgresAutoRequestCandidateSource,
  emailDomainMatchesWebsite,
  websiteHost,
  type AutoRequestCandidate,
  type AutoRequestOutcome,
} from "./application/auto-request.js";
export {
  closeKybForClaim,
  createKybService,
  type KybInput,
  type KybProvider,
  type KybService,
  type KybView,
  type PersonIdentityInput,
  type VerificationPart,
  type SubmitKybOutcome,
} from "./application/kyb.js";
export {
  createDecideByOperator,
  SYNTHETIC_REVIEWER_BASIS_PREFIX,
  type DecideByOperatorCommand,
  type DecideByOperatorOutcome,
} from "./application/decide-operator.js";
export { createPostgresSyntheticReviewerScope } from "./infrastructure/synthetic-reviewer-scope.js";
export type {
  DecideSyntheticCommand,
  DecideSyntheticOutcome,
} from "./application/decide-synthetic.js";
export {
  createCompanyVerificationService,
  createSyntheticVerificationDecider,
  type CompanyVerificationService,
} from "./application/service.js";
export {
  createPostgresPendingSyntheticClaimSource,
  createPostgresSyntheticPrincipalPort,
  createPostgresVerificationClaimRepository,
} from "./infrastructure/postgres-verification-repository.js";
export {
  createPostgresSyntheticSubjectReader,
  isSyntheticSubject,
  type SyntheticSubject,
  type SyntheticSubjectFacts,
} from "./infrastructure/synthetic-subject.js";
export {
  createPublicVerificationReader,
  createVerificationClaimsReadinessPort,
  type PublicClaimStanding,
  VERIFICATION_CLAIMS_SOURCE,
} from "./infrastructure/readiness-port.js";
export {
  VERIFICATION_EVENTS,
  VerificationClaimDecidedEvent,
  VerificationClaimRecordedEvent,
} from "./events/index.js";

export const PACKAGE_NAME = "@capital-q/verification" as const;
export {
  createDecidedClaimOwnerLookup,
  type DecidedClaimOwner,
} from "./infrastructure/decided-claim-owner.js";
// V1 (decision 113): providers, the linking rule, the badges.
export * from "./providers/contract.js";
export {
  companiesHouseNumber,
  COMPANIES_HOUSE_BASE_URL,
  createCompaniesHouseProvider,
} from "./providers/companies-house.js";
export {
  createDojahProvider,
  DOJAH_BASE_URL,
  DOJAH_KYB_COUNTRIES,
} from "./providers/dojah.js";
export {
  createSumsubProvider,
  SUMSUB_BASE_URL,
  sumsubSignature,
  type SumsubProvider,
} from "./providers/sumsub.js";
export {
  createVerificationProviders,
  identityProviderFor,
  providerConnections,
  registryProviderFor,
  VERIFICATION_PROVIDER_ENV,
  type ProviderConnection,
  type VerificationProviders,
} from "./providers/index.js";
export { matchNames, nameParts, type NameMatch } from "./domain/name-match.js";
export {
  BIOMETRIC_CONSENT_TEXT,
  BIOMETRIC_CONSENT_TEXT_VERSION,
  linkDecisionBasis,
  linkFounder,
  linkReviewReason,
  type LinkInput,
  type LinkMissing,
  type LinkOutcome,
  type LinkReviewReason,
} from "./domain/founder-link.js";
export {
  FULL_VERIFICATION_WINDOW_DAYS,
  foundersLine,
  VERIFICATION_BADGES,
  verificationTier,
  type BadgeView,
  type VerificationBadge,
  type VerificationTier,
} from "./domain/tiers.js";
export {
  FOUNDER_ID_VALID_MONTHS,
  settleFounderLink,
  type FounderLinkSettlement,
  type NewProviderDecision,
  type ProviderDecisionWriter,
  type VerificationReviewQueue,
} from "./application/founder-link.js";
export {
  startIdentityCheck,
  type IdentityCheckStart,
} from "./application/identity-check.js";
export {
  createPostgresProviderDecisionWriter,
  createPostgresVerificationReviewQueue,
  VERIFICATION_REVIEW_DUE_HOURS,
} from "./infrastructure/postgres-provider-decisions.js";
