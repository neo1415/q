/**
 * Classification (CQ-TAX-002): deterministic language -> canonical
 * TaxonomyNodeId candidates, provenance runs and human confirmation.
 * Ports for future semantic / model adapters are declared here; no
 * adapter, no model, no embedding exists in this release.
 */

export * from "./contracts/index.js";
export {
  TAXONOMY_CLASSIFICATION_INPUT_REASONS,
  TaxonomyClassificationCandidateDecidedError,
  TaxonomyClassificationCandidateNotFoundError,
  TaxonomyClassificationInputError,
  TaxonomyClassificationRunNotFoundError,
  TaxonomyClassifierNotAvailableError,
  type TaxonomyClassificationInputReason,
} from "./domain/errors.js";
export {
  TAXONOMY_CLASSIFICATION_POLICY_V1,
  type TaxonomyClassificationPolicy,
} from "./domain/policy.js";
export {
  hashClassificationInput,
  normalizeClassificationInput,
  tokenizeForLexicalSearch,
} from "./domain/tokenize.js";
export {
  formatConfidence,
  lexicalConfidence,
  lexicalScore,
  tokenCoverage,
  type LexicalScore,
  type LexicalScoreInput,
} from "./domain/scoring.js";
export {
  mergeCandidates,
  resolveCandidates,
  type MergedCandidate,
  type ResolvedCandidates,
} from "./domain/resolve.js";
export type {
  LexicalSearchHit,
  LexicalSearchQuery,
  ModelTaxonomyClassifier,
  NewTaxonomyClassificationCandidate,
  NewTaxonomyClassificationRun,
  SemanticTaxonomyCandidateProvider,
  TaxonomyCandidateGenerationRequest,
  TaxonomyCandidateGenerator,
  TaxonomyClassificationRunRepository,
  TaxonomyLexicalSearchRepository,
} from "./application/ports.js";
export {
  createCanonicalCodeExactGenerator,
  createExactAliasGenerator,
  createExactDisplayNameGenerator,
  createLexicalSearchGenerator,
} from "./application/generators.js";
export {
  createTaxonomyCandidateFinder,
  createTaxonomyClassifier,
  FindTaxonomyCandidatesInputSchema,
  type ClassificationScope,
  type ClassifyInScopeInput,
  type FindTaxonomyCandidatesInput,
  type TaxonomyCandidateFinder,
  type TaxonomyCandidateFinderDependencies,
  type TaxonomyClassifier,
  type TaxonomyClassifierDependencies,
} from "./application/candidate-service.js";
export {
  createAcceptCompanyClassificationCandidate,
  createClassifyWithProvenance,
  createGetCompanyClassificationRun,
  createRejectCompanyClassificationCandidate,
  type AcceptCompanyCandidateResult,
  type ClassificationRunDependencies,
  type ClassifyWithProvenanceCommand,
  type DecideCompanyCandidateCommand,
  type GetClassificationRunQuery,
  type TaxonomyClassificationRunResult,
} from "./application/classification-runs.js";
export { getTaxonomyMetrics } from "./application/metrics.js";
export { createPostgresTaxonomyLexicalSearchRepository } from "./infrastructure/postgres-lexical-search-repository.js";
export { createPostgresTaxonomyClassificationRunRepository } from "./infrastructure/postgres-classification-run-repository.js";
export {
  TAXONOMY_EVAL_FIXTURES,
  TAXONOMY_EVAL_FIXTURES_VERSION,
  type TaxonomyEvalFixture,
  type TaxonomyNodeRef,
} from "./evaluation/fixtures.js";
export {
  gradeFixture,
  summarizeEval,
  type TaxonomyEvalGrade,
  type TaxonomyEvalReport,
} from "./evaluation/graders.js";
