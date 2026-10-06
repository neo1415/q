/**
 * `@capital-q/gateq` — the GateQ bounded context (CQ-GATE-001).
 *
 * An investor organisation's front door: the policy it publishes about what
 * it is willing to be approached about, versioned so a historical decision
 * stays attributable, and a deterministic engine that answers one question.
 *
 *   gateway mode ≠ qualification outcome ≠ access decision
 *   GateQ published policy ≠ investor mandate
 *   qualified ≠ good company ≠ investment-ready ≠ recommended
 *   unknown ≠ no match
 *
 * It owns gateways, their versions and their criteria, and nothing else.
 * Companies, taxonomy, investor organisations, mandates, evidence, Q and
 * recommendation ranking all belong elsewhere and arrive through typed
 * ports. No model runs here, and nothing this package computes is a score.
 */

export * from "./contracts/index.js";

export {
  qualify,
  GateQPolicyNotPublishedError,
  QUALIFICATION_POLICY_VERSION,
  ALL_CRITERION_REASON_CODES,
  type QualifyInput,
} from "./domain/qualification.js";
export { publicProjectionOf } from "./domain/public-projection.js";
export { generateGatewayPublicId } from "./domain/public-id.js";
export {
  readMandate,
  mandateMentions,
  type MentionPolarity,
  MANDATE_READER_VERSION,
  MANDATE_TEXT_MAX_CHARS,
  SECTOR_VOCABULARY,
  type MandateDimension,
  type MandateReading,
  type MandateVocabularyNode,
  type PolicyProposal,
} from "./domain/mandate-reader.js";
export {
  createPolicyExtractionService,
  MandateTextEmptyError,
  type PolicyExtraction,
  type PolicyExtractionRecord,
  type PolicyExtractionRepository,
  type PolicyExtractionService,
  type PolicySourceKind,
} from "./application/policy-extraction.js";
export { createPostgresPolicyExtractionRepository } from "./infrastructure/postgres-policy-extraction-repository.js";

export {
  createGateQService,
  CompanyProjectionUnavailableError,
  GATEWAY_CREATE,
  GATEWAY_EDIT,
  GATEWAY_PUBLISH,
  GATEWAY_VIEW,
  GateQNoPublishedPolicyError,
  GatewayNotFoundError,
  GatewayVersionNotDraftError,
  type GateQDependencies,
  type GateQService,
} from "./application/use-cases.js";
export type {
  CompanyQualificationProjectionPort,
  GatewayPolicyPort,
  GatewayRepository,
  GatewayVersionRepository,
  InvestorOrganisationDisplayPort,
} from "./application/ports.js";

export {
  createPostgresGatewayPolicyPort,
  createPostgresGatewayRepository,
  createPostgresGatewayVersionRepository,
} from "./infrastructure/postgres-gateq-repository.js";

export const PACKAGE_NAME = "@capital-q/gateq" as const;
