export {
  assessInvestIQ,
  investiqInputHash,
  InvestIQInputError,
} from "./assess.js";
export {
  compareShadowWithLegacy,
  type ShadowDifference,
  type ShadowDimensionComparison,
} from "./compare.js";
export {
  CORE_DIMENSIONS,
  CoreDimensionSchema,
  FDN_DIMENSIONS,
  FdnDimensionSchema,
  InvestIQAssessmentSchema,
  InvestIQInputSchema,
  InvestIQObservationSchema,
  type CoreDimension,
  type CriterionState,
  type DimensionResult,
  type FdnDimension,
  type InvestIQAssessment,
  type InvestIQInput,
  type InvestIQObservation,
} from "./contracts.js";
export {
  investiqInputFromLegacyReadiness,
  LEGACY_PRIMARY_PILLAR,
  type LegacyReadinessAssessment,
  type LegacyShadowInput,
} from "./legacy-shadow.js";
export {
  INVESTIQ_SHADOW_METHOD_V0,
  type ApplicabilityRule,
  type CriterionDef,
  type InvestIQMethod,
  type RuleProvenance,
} from "./method-v0.js";
export {
  assessInvestIQV1,
  bandOf,
  confidenceOf,
  InvestIQV1AssessmentSchema,
  observationWeight,
  type InvestIQV1Assessment,
  type InvestIQV1Band,
} from "./assess-v1.js";
export {
  CONFIDENCE_RULES,
  COVERAGE_RULES,
  EVIDENCE_WEIGHT,
  GRADED_DIMENSIONS,
  INVESTIQ_V1,
  INVESTIQ_V1_CRITERIA,
  LIFECYCLE_WEIGHT,
  OUTPUT_GROUPS,
  READINESS_BANDS,
  STAGE_BANDS,
  STAGE_WEIGHTS,
  stageBandOf,
  TRUTH_WEIGHT,
  UNGRADED_CRITERIA,
  type ConfidenceLevel,
  type GradedDimension,
  type ReadinessBand,
  type StageBand,
  type V1Criterion,
} from "./method-v1.js";
