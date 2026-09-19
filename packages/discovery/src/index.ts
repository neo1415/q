/**
 * @capital-q/discovery — who an investor or a founder could reasonably
 * meet (doc 19).
 *
 * Owns: hard eligibility (a versioned, tri-state, deterministic gate —
 * CQ-REC-001), candidate generation, declared hard exclusions, explicit fit
 * over declared fields, and one deterministic ranking with a versioned
 * weight set.
 *
 * Does not own: canonical company or investor state, mandates, GateQ
 * rules, relationships, or any notion of interest. It writes nothing.
 *
 * Invariants: no model runs in this path; the slate is reproducible from
 * the rows alone; hard exclusions come only from declared rules; viewing
 * is not interest and behaviour is never read; an investor is matched
 * against their own mandate and a founder is never matched against
 * somebody else's.
 */

export {
  DISCOVERY_CANDIDATE_MAX,
  DISCOVERY_LIMIT_DEFAULT,
  DISCOVERY_LIMIT_MAX,
  DISCOVERY_NOTES,
  DISCOVERY_RANKING_VERSION,
  DISCOVERY_REASON_KINDS,
  DiscoveredCompanySchema,
  DiscoveredInvestorSchema,
  DiscoveryCompanySlateSchema,
  DiscoveryInvestorSlateSchema,
  DiscoveryNoteSchema,
  DiscoveryReasonKindSchema,
  DiscoveryReasonSchema,
  type DiscoveredCompany,
  type DiscoveredInvestor,
  type DiscoveryCompanySlate,
  type DiscoveryInvestorSlate,
  type DiscoveryNote,
  type DiscoveryReason,
  type DiscoveryReasonKind,
} from "./contracts.js";

export {
  declaredProfileFit,
  explicitFit,
  isExcluded,
  STAGE_LADDER,
  stageInRange,
  type DeclaredClassification,
  type DeclaredPreference,
  type FitOutcome,
} from "./domain/fit.js";

export {
  PREFERENCE_WEIGHT,
  preferenceWeight,
  rankCompanies,
  rankInvestors,
  reasonKindForVocabulary,
  SIGNAL_WEIGHT,
} from "./domain/ranking.js";

export type {
  CandidateCompany,
  CandidateInvestor,
  DiscoveryDisclosurePort,
  DiscoveryRepository,
  DiscoverySide,
  OwnMandate,
} from "./ports.js";

export {
  createDiscoveryService,
  type DiscoverQuery,
  type DiscoveryService,
  type DiscoveryServiceDependencies,
} from "./application/discover.js";

export { createPostgresDiscoveryRepository } from "./infrastructure/postgres-discovery-repository.js";

// Hard eligibility (CQ-REC-001): the gate before candidate generation.
export {
  CRITERION_OUTCOMES,
  CriterionOutcomeSchema,
  CriterionResultSchema,
  ELIGIBILITY_BATCH_MAX,
  ELIGIBILITY_CRITERIA,
  ELIGIBILITY_DECISIONS,
  ELIGIBILITY_POLICY_VERSION,
  ELIGIBILITY_REASON_CODES,
  ELIGIBILITY_SUPPORTED_MODES,
  EligibilityCriterionSchema,
  EligibilityDecisionSchema,
  EligibilityReasonCodeSchema,
  EligibilityResultSchema,
  RECOMMENDATION_MODES,
  RecommendationContextSchema,
  RecommendationModeSchema,
  type CriterionOutcome,
  type CriterionResult,
  type EligibilityCriterion,
  type EligibilityDecision,
  type EligibilityReasonCode,
  type EligibilityResult,
  type RecommendationContext,
  type RecommendationMode,
} from "./eligibility/contracts.js";
export {
  DECLARED_TAXONOMY_SOURCES,
  DISCOVERABLE_VISIBILITIES,
  evaluateHardEligibility,
  RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY,
  type EligibilityEvaluationInput,
} from "./eligibility/policy.js";
export type {
  ActiveMandateLookup,
  CompanyClassification,
  CompanyClassificationsPort,
  CompanyEligibilityFacts,
  CompanyEligibilityFactsPort,
  DiscoverabilityPort,
  EligibilityPorts,
  InvestorMandatePort,
  InvestorSubjectPort,
  MandateHardConstraint,
  MandateSnapshotForEligibility,
  MandateTaxonomyRule,
  RelationshipStanding,
  RelationshipStandingPort,
  TaxonomyVersionPort,
} from "./eligibility/ports.js";
export {
  createEligibilityService,
  EligibilityBatchTooLargeError,
  InvestorSubjectNotResolvedError,
  RecommendationModeUnsupportedError,
  type EligibilityEvaluation,
  type EligibilityService,
  type EligibilityServiceDependencies,
  type EvaluateEligibilityQuery,
} from "./eligibility/service.js";
export {
  createDomainEligibilityPorts,
  type DomainEligibilityPortDependencies,
} from "./infrastructure/domain-port-eligibility-sources.js";

// Structured candidate generation (CQ-REC-002): recall before precision.
export {
  CANDIDATE_DIMENSION_LIMIT,
  CANDIDATE_DIMENSIONS,
  CANDIDATE_POOL_MAX,
  CANDIDATE_REASON_CODES,
  CandidateDiagnosticsSchema,
  CandidateDimensionSchema,
  CandidateProvenanceSchema,
  CandidateReasonCodeSchema,
  MatchedNodeSchema,
  STRUCTURED_GENERATOR_ID,
  STRUCTURED_GENERATOR_VERSION,
  StructuredCandidateResultSchema,
  StructuredCandidateSchema,
  type CandidateDiagnostics,
  type CandidateDimension,
  type CandidateProvenance,
  type CandidateReasonCode,
  type MatchedNode,
  type StructuredCandidate,
  type StructuredCandidateResult,
} from "./candidates/contracts.js";
export {
  deriveStructuredIntent,
  GEOGRAPHY_VOCABULARY,
  mergeDimensionHits,
  UNRESTRICTED_GEOGRAPHY_CODE,
  type DimensionHit,
  type MergedCandidate,
  type StructuredIntent,
} from "./candidates/structured.js";
export {
  createNotComputableChequeRetrieval,
  type ChequeStructuredRetrievalPort,
  type CompanyStructuredRetrievalPort,
  type DiscoverableCompanyRef,
  type ExpandedPreferenceNode,
  type StructuredRetrievalPorts,
  type TaxonomyStructuredRetrievalPort,
  type TaxonomySubjectHit,
} from "./candidates/ports.js";
export {
  createStructuredCandidateService,
  type GenerateStructuredCandidatesQuery,
  type StructuredCandidateService,
  type StructuredCandidateServiceDependencies,
} from "./candidates/service.js";
export {
  createDomainCandidatePorts,
  type DomainCandidatePortDependencies,
} from "./infrastructure/domain-port-candidate-sources.js";

// Semantic candidate generation (CQ-REC-003): supplements structured recall.
export {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  REPRESENTATION_PURPOSE,
  REPRESENTATION_REFRESH_LIMIT,
  RepresentationRefreshReportSchema,
  SEMANTIC_GENERATOR_ID,
  SEMANTIC_GENERATOR_VERSION,
  SEMANTIC_SIMILARITY_METRIC,
  SEMANTIC_TOP_K,
  SemanticCandidateResultSchema,
  SemanticCandidateSchema,
  SemanticDiagnosticsSchema,
  SemanticProvenanceSchema,
  type RepresentationRefreshReport,
  type SemanticCandidate,
  type SemanticCandidateResult,
  type SemanticDiagnostics,
  type SemanticProvenance,
} from "./semantic/contracts.js";
export {
  buildCompanyInvestmentRepresentation,
  buildInvestorMandateRepresentation,
  REPRESENTATION_MAX_CHARACTERS,
  type BuiltRepresentation,
  type CompanyRepresentationInput,
  type InvestorRepresentationInput,
  type RepresentationClassification,
} from "./semantic/representation.js";
export type {
  CompanyInvestmentFacts,
  CompanyInvestmentFactsPort,
  DescribedNode,
  InvestorMandateNarrative,
  InvestorMandateNarrativePort,
  SemanticEmbedder,
  SemanticNearestHit,
  SemanticRepresentationStore,
  StoredRepresentation,
  VectorIdentity,
  VocabularyDescriptionPort,
} from "./semantic/ports.js";
export {
  createSemanticCandidateService,
  type GenerateSemanticCandidatesQuery,
  type RefreshCompanyRepresentationsInput,
  type SemanticCandidateService,
  type SemanticCandidateServiceDependencies,
} from "./semantic/service.js";
export {
  createPostgresSemanticRepresentationStore,
  fromVectorLiteral,
  toVectorLiteral,
} from "./infrastructure/postgres-semantic-store.js";
export {
  createDomainSemanticPorts,
  type DomainSemanticPortDependencies,
  type DomainSemanticPorts,
} from "./infrastructure/domain-port-semantic-sources.js";

// The hybrid pool: structured UNION semantic, one company, both provenances.
export {
  HYBRID_POOL_VERSION,
  HybridCandidatePoolSchema,
  HybridCandidateSchema,
  HybridDiagnosticsSchema,
  type HybridCandidate,
  type HybridCandidatePool,
  type HybridDiagnostics,
} from "./hybrid/contracts.js";
export { mergeCandidatePools } from "./hybrid/merge.js";
export {
  createHybridCandidateService,
  type GenerateHybridCandidatesQuery,
  type HybridCandidateService,
  type HybridCandidateServiceDependencies,
} from "./hybrid/service.js";

// The recommendation feature registry and privacy firewall (CQ-REC-004):
// the only legitimate input surface for a ranker.
export {
  FEATURE_DATA_TYPES,
  FEATURE_GROUPS,
  FEATURE_MISSING_POLICIES,
  FEATURE_MISSING_REASONS,
  FEATURE_ORDER,
  FEATURE_SCHEMA_VERSION,
  FEATURE_SNAPSHOT_VALUES_MAX,
  FEATURE_SOURCE_CLASSES,
  FEATURE_VALUE_STATUSES,
  FeatureDataTypeSchema,
  FeatureGroupSchema,
  FeatureIdSchema,
  FeatureMissingPolicySchema,
  FeatureMissingReasonSchema,
  FeatureProvenanceSchema,
  FeatureSensitivitySchema,
  FeatureSourceClassSchema,
  FeatureValueSchema,
  FeatureValueStatusSchema,
  FeatureVersionSchema,
  RECOMMENDATION_FEATURES,
  RecommendationFeatureDefinitionSchema,
  RecommendationFeatureSnapshotSchema,
  SnapshotCandidateProvenanceSchema,
  validateFeatureRegistry,
  type FeatureDataType,
  type FeatureGroup,
  type FeatureMissingPolicy,
  type FeatureMissingReason,
  type FeatureProvenance,
  type FeatureSensitivity,
  type FeatureSourceClass,
  type FeatureValue,
  type FeatureValueStatus,
  type RecommendationFeatureDefinition,
  type RecommendationFeatureSnapshot,
  type SnapshotCandidateProvenance,
} from "./features/contracts.js";
export {
  checkValue,
  computeFeatureValues,
  createFeatureRegistry,
  FeatureContextNotAllowedError,
  snapshotFingerprint,
  snapshotSensitivity,
  toSnapshotCandidateProvenance,
  type CandidateProvenanceProjection,
  type CompanyStateProjection,
  type CompanyTaxonomyProjection,
  type ComputedFeature,
  type FeatureInputs,
  type FeatureRegistry,
  type PreferenceHierarchyProjection,
} from "./features/policy.js";
export type {
  CompanyFeatureProjection,
  CompanyFeatureProjectionPort,
  FeatureSnapshotStore,
  PreferenceHierarchyPort,
  StoredFeatureSnapshotRef,
} from "./features/ports.js";
export {
  CandidateNotRankableError,
  createFeatureService,
  type ComputeFeaturesQuery,
  type ComputeFeaturesResult,
  type FeatureComputationDiagnostics,
  type FeatureService,
  type FeatureServiceDependencies,
} from "./features/service.js";
export {
  createPostgresFeatureSnapshotStore,
  readCurrentFeatureSnapshot,
} from "./infrastructure/postgres-feature-snapshot-store.js";
export {
  createDomainFeaturePorts,
  type DomainFeaturePortDependencies,
  type DomainFeaturePorts,
} from "./infrastructure/domain-port-feature-sources.js";

// The deterministic V1 ranker (CQ-REC-005): feature snapshots in, an
// internal ordering out. Not a probability, not a quality score, not public.
export {
  FACTOR_POLARITIES,
  FactorPolaritySchema,
  InactiveFeatureSchema,
  NormalizationSchema,
  RANKING_CONFIG_STATUSES,
  RANKING_CONFIG_V1,
  RANKING_CONFIGS,
  RANKING_REASON_CODES,
  RankingConfigError,
  RankingConfigSchema,
  RankingFactorSchema,
  RankingReasonCodeSchema,
  validateRankingConfig,
  validateRankingConfigs,
  type FactorPolarity,
  type Normalization,
  type RankingConfig,
  type RankingFactor,
  type RankingReasonCode,
} from "./ranking/config.js";
export {
  FACTOR_OUTCOMES,
  FactorOutcomeSchema,
  FactorResultSchema,
  RANKER_ID,
  RANKER_VERSION,
  RANKING_INPUT_ERRORS,
  RankedCandidateSchema,
  RankingDiagnosticsSchema,
  RankingInputError,
  type FactorResult,
  type RankedCandidate,
  type RankingDiagnostics,
  type RankingInputErrorCode,
} from "./ranking/contracts.js";
export {
  createDeterministicRanker,
  normalizeFactorValue,
  rankSnapshots,
  scoreSnapshot,
  validateRankingInput,
  type EnrichedCandidate,
  type Ranker,
  type RankingContext,
} from "./ranking/ranker.js";
export {
  createRankingService,
  type RankCandidatesQuery,
  type RankCandidatesResult,
  type RankingRunDiagnostics,
  type RankingService,
} from "./ranking/service.js";

// Persisted recommendation slates (CQ-REC-006): the durable, versioned,
// immutable output of one pipeline run, served by cursor.
export {
  decodeSlateCursor,
  encodeSlateCursor,
  NewRecommendationItemSchema,
  RecommendationItemIdSchema,
  RecommendationItemSchema,
  RecommendationSlateSchema,
  REFRESH_PRIORITIES,
  REFRESH_REASONS,
  REFRESH_REQUEST_STATUSES,
  RefreshPrioritySchema,
  RefreshReasonSchema,
  RefreshRequestStatusSchema,
  SLATE_INVALIDATION_REASONS,
  SLATE_POLICY_V1,
  SLATE_STATUSES,
  SlateCursorSchema,
  SlateDiagnosticsSchema,
  SlateIdSchema,
  SlateInvalidationReasonSchema,
  SlatePolicySchema,
  SlateStatusSchema,
  SlateVersionsSchema,
  type NewRecommendationItem,
  type RecommendationItem,
  type RecommendationSlate,
  type RefreshPriority,
  type RefreshReason,
  type RefreshRequestStatus,
  type SlateCursor,
  type SlateDiagnostics,
  type SlateInvalidationReason,
  type SlatePolicy,
  type SlateStatus,
  type SlateVersions,
} from "./slates/contracts.js";
export {
  SlateBuildInProgressError,
  type BeginBuildInput,
  type PublishInput,
  type RefreshRequest,
  type RefreshRequestStore,
  type SlateKey,
  type SlateRepository,
} from "./slates/ports.js";
export {
  createPostgresRefreshRequestStore,
  createPostgresSlateRepository,
} from "./infrastructure/postgres-slate-repository.js";

export {
  createSlateBuilder,
  SLATE_BUILD_FAILURE_CODES,
  SLATE_FINGERPRINT_VERSION,
  slateFingerprint,
  SlateBuildError,
  type BuildSlateQuery,
  type BuildSlateResult,
  type SlateBuildFailureCode,
  type SlateBuilder,
  type SlateBuilderDependencies,
} from "./slates/builder.js";
export {
  createRecommendationPipeline,
  type RecommendationPipeline,
  type RecommendationPipelineDependencies,
} from "./infrastructure/recommendation-pipeline.js";

export {
  RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE,
  RECOMMENDATION_REFRESH_QUEUE,
  REFRESH_RECOMMENDATION_SLATE_JOB_DATA,
  RefreshRecommendationSlateJob,
  type RefreshRecommendationSlateJobData,
} from "./jobs/index.js";
export {
  createRefreshRequester,
  createSlateInvalidationService,
  INVALIDATION_FAN_OUT_MAX,
  REFRESH_TRIGGER_EVENTS,
  refreshDirectiveFor,
  sendRefreshJob,
  type InvalidationOutcome,
  type RefreshJobInput,
  type RefreshDirective,
  type RefreshQueue,
  type RefreshRequester,
  type RequestRefreshInput,
  type RequestRefreshResult,
  type SlateInvalidationService,
} from "./slates/refresh.js";

export const PACKAGE_NAME = "@capital-q/discovery" as const;
