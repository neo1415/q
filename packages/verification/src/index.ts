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
  standingOf,
  SUBJECT_TYPE_OF,
  type VerificationClaim,
  type VerificationProvider,
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
  closeKybForClaim,
  createKybService,
  type KybInput,
  type KybProvider,
  type KybService,
  type KybView,
  type SubmitKybOutcome,
} from "./application/kyb.js";
export {
  createDecideByOperator,
  type DecideByOperatorCommand,
  type DecideByOperatorOutcome,
} from "./application/decide-operator.js";
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
