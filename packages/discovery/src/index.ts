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
  PROSPECT_FIT_VERSION,
  PROSPECT_REASON_KINDS,
  PROSPECT_WEIGHT,
  prospectFit,
  rankProspects,
  TYPICAL_STAGES_BY_INVESTOR_TYPE,
  type ProspectCompany,
  type ProspectFit,
  type ProspectInvestor,
  type ProspectReason,
  type ProspectReasonKind,
} from "./domain/prospect-fit.js";

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
  ELIGIBILITY_POLICY_VERSIONS,
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
  declaredHardExclusions,
  evaluateHardEligibility,
  excludingRules,
  HARD_EXCLUSION_CRITERIA,
  RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY,
  unverifiableHardExclusions,
  unverifiedExclusions,
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
  MaterialChangePort,
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
  ELIGIBILITY_PURPOSES,
  type EligibilityPurpose,
  RECOMMENDATION_VIEWPOINTS,
  type RecommendationViewpoint,
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
  STRUCTURED_GENERATOR_VERSIONS,
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
  COMPANY_REPRESENTATION_VERSIONS,
  INVESTOR_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSIONS,
  REPRESENTATION_PURPOSE,
  REPRESENTATION_REFRESH_LIMIT,
  RepresentationRefreshReportSchema,
  SEMANTIC_GENERATOR_ID,
  SEMANTIC_GENERATOR_VERSION,
  SEMANTIC_GENERATOR_VERSIONS,
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
  FEATURE_SCHEMA_VERSIONS,
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
  RankableCandidateProvenanceSchema,
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
  readFeatureSnapshotById,
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
  RANKING_CONFIG_CURRENT,
  RANKING_CONFIG_V1,
  RANKING_CONFIG_V2,
  RANKING_CONFIG_V3,
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
  RANKER_VERSIONS,
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
  type CompanyCard,
  type CompanyCardPort,
  type DiscoverablePoolPort,
  type DiscoverablePoolSummary,
  type RefreshRequest,
  type RefreshRequestStore,
  type SlateKey,
  type SlateRepository,
} from "./slates/ports.js";
export {
  createPostgresRefreshRequestStore,
  createPostgresSlateRepository,
} from "./infrastructure/postgres-slate-repository.js";

// CQ-REC-009 -- bounded diversity and exploration.
export {
  RERANK_REASON_CODES,
  RERANK_INPUT_ERRORS,
  RerankInputError,
  RERANKER_ID,
  RERANKER_VERSION,
  type RerankDiagnostics,
  type RerankFacts,
  type RerankInputErrorCode,
  type RerankReasonCode,
  type RerankedCandidate,
} from "./rerank/contracts.js";
export {
  EXPLORATION_POLICY_V1,
  PASS_REINTRODUCTION_REASONS,
  PROVABLE_PASS_REINTRODUCTION_REASONS,
  RERANK_POLICY_STATUSES,
  type PassReintroductionReason,
  type RerankPolicy,
} from "./rerank/policy.js";
export {
  type PassReintroductionPort,
  type RerankSignals,
  type RerankSignalsPort,
} from "./rerank/ports.js";
export {
  createReranker,
  type BaseRankedCandidate,
  type Reranker,
  type RerankInput,
  type RerankResult,
} from "./rerank/reranker.js";
export {
  clusterKeyFor,
  createRerankService,
  type RerankPoolQuery,
  type RerankService,
} from "./rerank/service.js";
export {
  createProactiveSuppression,
  suppressedFromProactiveDiscovery,
  type ProactiveSuppressionPort,
} from "./rerank/suppression.js";
export { createInteractionRerankSignals } from "./infrastructure/interaction-rerank-signals.js";

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
  createSlateReadPipeline,
  type RecommendationPipeline,
  type RecommendationPipelineDependencies,
  type SlateReadPipeline,
  type SlateReadPipelineDependencies,
} from "./infrastructure/recommendation-pipeline.js";
export {
  createSlateReadService,
  PUBLIC_REASON_CODES,
  SLATE_PAGE_NOTES,
  SlateCursorRejectedError,
  type PageCompaniesQuery,
  type SlatePage,
  type SlatePageItem,
  type SlatePageNote,
  type SlateReadService,
  type SlateReadServiceDependencies,
} from "./slates/reader.js";
export {
  compareAmounts,
  discoverFiltersFingerprint,
  evaluateDiscoverFilters,
  type CompanyFilterFacts,
  type DiscoverFilterFactsPort,
  type FilterMoney,
  type FilterVerdict,
} from "./slates/filters.js";
export { createPostgresRefreshQueue } from "./infrastructure/postgres-refresh-queue.js";
export {
  createPostgresCompanyCardPort,
  createPostgresDiscoverablePoolPort,
} from "./infrastructure/postgres-discovery-repository.js";

export {
  RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE,
  RECOMMENDATION_REFRESH_QUEUE,
  REFRESH_RECOMMENDATION_SLATE_JOB_DATA,
  RefreshRecommendationSlateJob,
  type RefreshRecommendationSlateJobData,
} from "./jobs/index.js";
export {
  createRefreshRequester,
  DEPLOYED_SLATE_VERSIONS,
  requestRebuildsForVersionDrift,
  versionDrift,
  type DeployedSlateVersions,
  type VersionDriftOutcome,
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

// Recommendation explanations (CQ-REC-007): why an investor is seeing a
// company, derived from the factors that produced the ordering.
export {
  EXPLANATION_DIMENSIONS,
  EXPLANATION_OUTCOMES,
  EXPLANATION_REFUSALS,
  EXPLANATION_VERSION,
  ExplanationDimensionSchema,
  ExplanationFactorSchema,
  ExplanationOutcomeSchema,
  ExplanationRefusalSchema,
  RecommendationExplanationSchema,
  type ExplainResult,
  type ExplanationDimension,
  type ExplanationFactor,
  type ExplanationOutcome,
  type ExplanationRefusal,
  type RecommendationExplanation,
} from "./explanations/contracts.js";
export {
  INTERACTION_STRENGTH_CLASSES,
  INTERACTION_SURFACES,
  INTERACTION_TYPES,
  INTERACTION_VERSION,
  InteractionEventSchema,
  InteractionStateSchema,
  InteractionTypeSchema,
  PASS_REASONS,
  WATCH_MILESTONES,
  type InteractionEvent,
  type InteractionExposure,
  type InteractionRefusal,
  type InteractionState,
  type InteractionStrengthClass,
  type InteractionSurface,
  type InteractionType,
  type PassReason,
  type RecordInteractionResult,
  type WatchMilestone,
} from "./interactions/contracts.js";
export {
  createInteractionSignalService,
  type InteractionCommand,
  type InteractionOutcome,
  type InteractionSignalDependencies,
  type InteractionSignalService,
} from "./interactions/service.js";
export {
  isClientWritable,
  isObservation,
  strengthClassFor,
} from "./interactions/policy.js";
export type {
  InteractionCompanyPort,
  InteractionExposurePort,
  InteractionRepository,
  NewInteractionEvent,
} from "./interactions/ports.js";
export {
  createPostgresInteractionRepository,
  createPostgresInvestorDecisionReader,
  type InvestorCompanyDecision,
} from "./infrastructure/postgres-interaction-repository.js";

export {
  createCurrentSlateExplanationService,
  type CurrentSlateExplanationDependencies,
  type CurrentSlateExplanationService,
  type ExplainCurrentRecommendationQuery,
} from "./explanations/current.js";
export {
  deterministicSummary,
  rankingVersionLabel,
  toExplanationFactors,
  type ExplanationBuckets,
} from "./explanations/policy.js";
export {
  createRecommendationExplanationService,
  type ExplainRecommendationQuery,
  type ExplanationNarrator,
  type ExplanationSnapshotPort,
  type RecommendationExplanationDependencies,
  type RecommendationExplanationService,
} from "./explanations/service.js";

export const PACKAGE_NAME = "@capital-q/discovery" as const;

export {
  createPitchReintroductions,
  NEW_PITCH_CHANGE,
  type PublishablePitchTimesPort,
} from "./rerank/pitch-reintroductions.js";
export type { PassReintroduction } from "./rerank/ports.js";
export { createMaterialChanges } from "./infrastructure/material-changes.js";
export { createPostgresCompanySectorsPort } from "./infrastructure/postgres-filter-facts.js";

// MATCH block (B1-B3; ADR 0052): the fit profile with a mandate.
export {
  FIT_CONFIG_CURRENT,
  FIT_CONFIG_V4,
  FIT_CONFIGS,
  FitConfigSchema,
  fitConfigByVersion,
  type FitConfig,
} from "./fit/config.js";
export {
  FIT_REASON_TEMPLATES,
  FIT_REASON_TEMPLATES_VERSION,
  renderFitReason,
  type FitReasonKey,
} from "./fit/templates.js";
export {
  assessFit,
  compareAssessments,
  notApplicableObservation,
  unknownObservation,
  type FitAssessment,
  type FitInputs,
  type FitObservation,
} from "./fit/model.js";
export {
  formatMoney,
  hardRuleFrom,
  observeFit,
  type DeclaredFitFacts,
  type DeclaredMoney,
  type ObserveFitInput,
} from "./fit/observe.js";
export {
  FIT_TOP_CANDIDATES_MAX,
  buildFitComparison,
  createFitService,
  fitComparisonText,
  fitProfileText,
  type FitCandidate,
  type FitCompanyInputs,
  type FitInputSource,
  type FitProfileItem,
  type FitProfilesResult,
  type FitService,
  type FitServiceDependencies,
  type FitTopResult,
} from "./fit/service.js";
export {
  FIT_ORDER_CURRENT,
  FIT_ORDER_V1,
  compareFitOrder,
  createFitOrdering,
  fitOrderScore,
  orderByFit,
  type FitOrderEntry,
  type FitOrderKey,
  type FitOrderedCandidate,
  type FitOrdering,
} from "./fit/order.js";
export {
  createFitInputSource,
  stageLabel,
  type FitInputSourceDependencies,
} from "./infrastructure/fit-inputs.js";
// end MATCH block
// Explore (E1-E5, ADR 0055): the network-wide pitch slate.
export {
  EXPLORE_CONFIG_V1,
  EXPLORE_RANKING_VERSION,
  NO_SIGNALS as EXPLORE_NO_SIGNALS,
  RELATED_MAX as EXPLORE_RELATED_MAX,
  diversify as diversifyExplore,
  exploreCandidates,
  exploreSlate,
  relatedPitches,
  type ExploreCandidate,
  type ExploreConfig,
  type ExplorePoolItem,
  type ExploreSignals,
  type RelatedPitch,
} from "./explore/policy.js";
export {
  EXPLORE_PAGE_DEFAULT,
  EXPLORE_PAGE_MAX,
  ExploreCursorRejectedError,
  decodeExploreCursor,
  encodeExploreCursor,
  exploreSlatePage,
  type ExploreSlatePage,
} from "./explore/page.js";
export {
  EXPLORE_POOL_MAX,
  createExploreService,
  declaredWords,
  matchesExploreText,
  normaliseExploreText,
  type ExploreCompanyFacts,
  type ExploreNetworkRow,
  type ExplorePitch,
  type ExplorePorts,
  type ExploreService,
} from "./explore/service.js";
