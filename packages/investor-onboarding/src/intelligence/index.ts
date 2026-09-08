/**
 * Investor Mandate Q (CQ-Q-022).
 *
 * What Q does with an investor's own description of what they invest in:
 * read it, propose a structured mandate, and ask before anything becomes an
 * eligibility rule.
 *
 *   narrative + selections → ONE model call → validated proposals
 *                          → the investor confirms, edits or rejects
 *                          → the Investor service writes and versions it
 *
 * Nothing here writes a mandate, resolves an ambiguity, confirms an
 * exclusion, or lets observed behaviour rewrite a declaration.
 */

export type {
  ConfirmedMandateInput,
  ExclusionDecision,
  MandateAmbiguity,
  MandateInference,
  MandateStrength,
  MandateSynthesis,
  MandateSynthesisTelemetry,
  ProposedConstraint,
  ProposedTaxonomyPhrase,
  RefusedCriterion,
} from "./contracts.js";
export {
  confirmMandate,
  discoveryModeFrom,
  pendingExclusions,
  sameMandate,
  type ConfirmationInput,
} from "./confirmation.js";
export {
  confirmedExclusionClass,
  constraintDimensionFor,
  isColumnDimension,
  preferenceClassFor,
  PROTECTED_SCREENING_MESSAGE,
  proposesExclusion,
  requestsProtectedScreening,
  requiresTaxonomyMapping,
} from "./semantics.js";
export {
  createMandateSynthesis,
  synthesisIsCurrent,
  type MandateSynthesisDependencies,
  type MandateSynthesisGateway,
  type MandateSynthesisRequest,
  type MandateTaxonomyPort,
} from "./synthesis.js";
