/**
 * Founder Onboarding Q (CQ-Q-021).
 *
 * What Q does with a founder's own material during onboarding: read it,
 * show what it understood, and ask only what is still worth asking.
 *
 *   documents → passages → one model call → validated candidates
 *             → suggestions a founder confirms, edits or rejects
 *             → the journey's existing validated-response path
 *
 * Nothing here writes a company, resolves a contradiction, or decides that
 * a founder is finished. It proposes; the onboarding runtime and the owning
 * domains decide.
 */

export {
  FOUNDER_FOLLOW_UP_BUDGET,
  FOUNDER_QUESTION_REASONS,
  FounderSuggestionDraftSchema,
  type FounderAmbiguity,
  type FounderCandidate,
  type FounderConflict,
  type FounderExtractionOutcome,
  type FounderExtractionTelemetry,
  type FounderSourceOrigin,
  type FounderSuggestionDraft,
  type FounderTaxonomySuggestion,
  type PlannedQuestion,
} from "./contracts.js";
export {
  createFounderExtraction,
  FOUNDER_EXTRACTION_MAX_PASSAGE_CHARS,
  FOUNDER_EXTRACTION_MAX_PASSAGES,
  type FounderExtractionDependencies,
  type FounderExtractionGateway,
  type FounderExtractionRequest,
  type FounderExtractionSource,
} from "./extraction.js";
export {
  businessShapeFrom,
  describeBusinessShape,
  factAppliesTo,
  factKeyForStep,
  FOUNDER_REQUIRED_FACTS,
  stepForFactKey,
  type BusinessShape,
} from "./mapping.js";
export {
  planFollowUpQuestions,
  requiredFactsOutstanding,
  type PlannerInput,
} from "./planner.js";
export {
  describeOrigins,
  draftSuggestions,
  FOUNDER_SOURCE_REF_TYPES,
  isDirectlySuggestable,
} from "./suggestions.js";
export {
  createFounderReview,
  passagesFrom,
  sessionFactsFrom,
  type FounderReviewCommand,
  type FounderReviewDependencies,
  type FounderReviewPlan,
  type FounderSessionFacts,
} from "./review.js";
