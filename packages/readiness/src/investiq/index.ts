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
