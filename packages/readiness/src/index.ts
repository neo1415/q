export {
  assess,
  evaluate,
  nextActions,
  type ActionMark,
  type CheckOutcome,
  type ReadinessAssessment,
} from "./domain/assess.js";
export { buildBlueprint } from "./domain/blueprint.js";
export {
  stageRank,
  type ReadinessClaimInput,
  type ReadinessDeckFigure,
  type ReadinessDeckSection,
  type ReadinessInputs,
} from "./domain/inputs.js";
export { FACT_PILLAR, readSignal } from "./domain/signals.js";
export {
  basisHash,
  createReadinessService,
  type ReadinessAnswerOutcome,
  type ReadinessFollowUpPort,
  type ReadinessFollowUpSource,
  type ReadinessPorts,
  type ReadinessService,
} from "./application/service.js";
export {
  createPostgresReadinessStore,
  type ReadinessProfileFacts,
  type ReadinessStore,
} from "./infrastructure/postgres.js";
export {
  READINESS_RULES_V1,
  type ReadinessCheckRule,
  type ReadinessRules,
  type ReadinessSeverity,
  type ReadinessSignal,
} from "./rules/v1.js";
export {
  readinessDataRoomFrom,
  confirmedDeckFigures,
  readinessDeckFrom,
  readinessFollowUps,
  readinessRaiseFrom,
  type ReadinessObjective,
  type ReadinessOnboardingPort,
} from "./application/sources.js";
// InvestIQ shadow assessment (ADR 0068, PROPOSED): never replaces a
// production readiness, fit or card value.
export * from "./investiq/index.js";
// Investability (owner 2026-10-16): InvestIQ v1, investor-facing, computed
// ONLY from investor-eligible inputs (src/investability/inputs.ts). It never
// reads the founder's readiness diagnosis, coaching or private records.
export * from "./investability/index.js";
// Optional present-evidence growth indicator; separate from InvestIQ and fit.
export {
  assessUnicornPotential,
  type UnicornPotentialResult,
} from "./unicorn-potential/assess.js";
export {
  observeUnicornPotential,
  type UnicornObservation,
} from "./unicorn-potential/observe.js";
export {
  UNICORN_PILLARS,
  UNICORN_POTENTIAL_METHOD_VERSION,
  UNICORN_POTENTIAL_INPUT_RULES_VERSION,
} from "./unicorn-potential/method-v1.js";
