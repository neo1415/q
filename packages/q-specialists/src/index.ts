/**
 * @capital-q/q-specialists
 *
 * Owns: the bounded Q specialist contract (CQ-Q-020 §7-§11) and the
 * Company Intelligence specialist — deterministic assembly over canonical
 * structured state, authorised Q Knowledge and authorised hybrid
 * retrieval, one governed model call through the Model Gateway, and
 * structured institutional findings whose citations resolve to references
 * the server supplied.
 *
 * Does not own: the run lifecycle (q-runtime), orchestration
 * (q-orchestrator), the Context Firewall (q-firewall), prompts (q-core),
 * models or providers (model-gateway), tools (q-tools), knowledge or
 * retrieval (q-knowledge), or any database.
 *
 *   Company Intelligence ≠ InvestIQ
 *   Company Intelligence ≠ matching ≠ recommendation ≠ investor fit
 *   Company Intelligence ≠ the canonical Company domain
 *   a specialist ≠ an agent a person talks to
 *
 * There is no provider SDK, no SQL, no HTTP client, no write and no
 * scoring anywhere in this package, and a person never learns it ran. Its
 * one outward-facing read — bounded public-web research — goes through the
 * Tool Registry like every other read (CQ-Q-RESEARCH-001).
 */

export {
  Q_SPECIALIST_BLOCKED_REASONS,
  specialistVersionId,
  type QSpecialist,
  type QSpecialistBlockedReason,
  type QSpecialistExecutionContext,
  type QSpecialistFinding,
  type QSpecialistProbe,
} from "./contracts.js";

export {
  assembleCompanyContext,
  COMPANY_CONTEXT_MAX_FACTS,
  knowledgeToFact,
  labelAt,
  passageToFact,
  publicSourceToFact,
  type AssembledCompanyContext,
  type CompanyContextInput,
  type LabelledFact,
} from "./company/assembly.js";
export type {
  CompanyContradictionFinding,
  CompanyDimensionCoverage,
  CompanyFinding,
  CompanyIntelligenceFocus,
  CompanyIntelligenceRequest,
  CompanyIntelligenceResult,
  CompanyIntelligenceTelemetry,
  CompanyMaterialChangeFinding,
} from "./company/contracts.js";
export {
  contradictionFindings,
  coverageByDimension,
  deterministicFindings,
  informationConfidence,
  institutionalNotes,
  materialChangeFindings,
  type DeterministicInput,
} from "./company/deterministic.js";
export {
  asksAboutChange,
  asksAboutGaps,
  dimensionForKnowledgeKey,
  focusFromQuestion,
} from "./company/dimensions.js";
export {
  COMPANY_KNOWLEDGE_LIMIT,
  COMPANY_PASSAGE_LIMIT,
  createKnowledgeCompanyPort,
  createRetrievalEvidencePort,
  createToolCanonicalPort,
  createToolResearchPort,
} from "./company/adapters.js";
export type {
  CompanyCanonicalPort,
  CompanyEvidencePort,
  CompanyKnowledgePort,
  CompanyResearchPort,
  CompanyResearchRead,
  PublicWebComparisonNote,
  PublicWebSource,
} from "./company/ports.js";
export {
  COMPANY_INTELLIGENCE_ID,
  COMPANY_INTELLIGENCE_VERSION,
  citePublicSources,
  createCompanyIntelligenceSpecialist,
  type CompanyIntelligenceDependencies,
} from "./company/specialist.js";
export {
  assertsAbsence,
  assertsForbiddenClaim,
  boundedTruthClass,
  validateModelFindings,
  type FindingValidation,
  type ValidationInput,
} from "./company/validation.js";

export {
  createSpecialistQAnswer,
  type SpecialistQAnswer,
  type SpecialistQAnswerDependencies,
  type QVisibilityNotebook,
} from "./answer.js";

export const PACKAGE_NAME = "@capital-q/q-specialists" as const;

// Recommendation explanations in Q's voice (CQ-REC-007 C). The facts come
// from the recommendation model; this only phrases them.
export {
  createRecommendationNarrator,
  groundingFailure,
  NARRATION_UNAVAILABLE_REASONS,
  type NarratableFactor,
  type NarrationUnavailableReason,
  type RecommendationNarration,
  type RecommendationNarrationRequest,
  type RecommendationNarrator,
  type RecommendationNarratorDependencies,
} from "./recommendation/narrator.js";
// MATCH block (ADR 0052): Q's view beside a computed fit.
export {
  createFitQViewer,
  fitQViewGroundingFailure,
  type FitQViewer,
  type FitQViewerDependencies,
  type FitQViewRequest,
} from "./recommendation/fit-q-view.js";

export {
  applyRevisedBodies,
  composeInvestmentBrief,
  inventsFigures,
  type ComposedInvestmentBrief,
} from "./company/investment-brief.js";

export {
  composePitchDeck,
  type ComposedPitchDeck,
} from "./company/pitch-deck.js";

export {
  createBriefReviser,
  type BriefReviser,
} from "./company/brief-reviser.js";

export type { ArtifactPreparationPort } from "./company/artifact-port.js";
export {
  latestArtifactIn,
  prepareOrReviseArtifact,
  type ArtifactPreparationOutcome,
  type ArtifactPreparation,
} from "./company/prepare-artifact.js";
export { createToolOwnMandatePort } from "./own-mandate-port.js";
export {
  createToolOwnRecordsPort,
  type QOwnRecordsPort,
} from "./own-records-port.js";
export {
  resolveOwnRecord,
  type OwnRecordMatch,
  type OwnRecordNames,
} from "./company/own-names.js";
export {
  composeOwnMandateDocument,
  type MandateLabels,
  OWN_MANDATE_ARTIFACT_TYPE,
  type OwnMandateDocument,
} from "./own-mandate-document.js";

export {
  illustrateDeck,
  type StockPhoto,
  type StockPhotoPort,
} from "./company/deck-photos.js";

// DOCS block: one answer as a document, for the per-answer PDF control.
export {
  ANSWER_DOCUMENT_ARTIFACT_TYPE,
  composeAnswerDocument,
  type AnswerDocument,
} from "./answer-document.js";

// DOCS block: the document studio's steps.
export {
  applyPolish,
  auditDocument,
  brandDeck,
  createDeckPolisher,
  designDeck,
  keepOnlyGroundedVisuals,
  refineCharts,
  runDocumentStudio,
  ungroundedFigures,
  type DeckPolisher,
  type DocumentStudioInput,
  type StudioBrand,
} from "./company/document-studio.js";

// Q room W5 (R8): the document pipeline.
export { visibleStageOf } from "./company/prepare-artifact.js";
export type { DocumentPipelinePort } from "./company/artifact-port.js";
export {
  addGapPlaceholders,
  applyFixes,
  chooseLayouts,
  composeGeneralDocument,
  creditInNotes,
  DOCUMENT_KINDS,
  FIX_ROUNDS_MAX,
  GENERATED_IMAGES_MAX,
  markOwnPictureSpaces,
  reviewDocument,
  runDocumentPipeline,
  SLIDE_BODY_WORDS_MAX,
  type DocumentCritic,
  type DocumentFix,
  type DocumentKind,
  type DocumentPipelineInput,
  type DocumentPipelineResult,
  type DocumentReview,
  type OwnPicturePort,
} from "./company/document-pipeline.js";

// DOCS block: generated illustrations.
export {
  illustrateWithGenerated,
  illustrationPrompt,
  ILLUSTRATIONS_PER_DECK,
  type IllustrationPort,
} from "./company/deck-illustrations.js";
export {
  approvesByWords,
  decidePending,
  startPendingDecision,
  type PendingDecisionStart,
  declinesByWords,
  isReplyToCard,
  readyLine,
  restatesCard,
  statusLine,
  type DecisionReading,
  type PendingTurnReading,
  type PendingDecisionContext,
  type PendingDecisionOutcome,
  type PendingDecisionPort,
  type PendingDecisionStatus,
} from "./pending-decision.js";
export {
  actOnHandOver,
  createToolHandOverPort,
  handOverSubjectOf,
  HAND_OVER_CALL_PURPOSE,
  type HandOverOutcome,
  type HandOverSubject,
  type QHandOverPort,
} from "./hand-over.js";
export {
  actOnDelegation,
  createToolDelegationPort,
  DELEGATION_CANDIDATE,
  DELEGATION_TOOL,
  delegationLine,
  type DelegationContext,
  type QDelegationPort,
} from "./delegation.js";
export {
  createToolProfileGapsPort,
  type ProfileGapReader,
  type ProfileGapReading,
  type ProfileGapSource,
  type QProfileGapsPort,
} from "./profile-gaps.js";
export {
  appActionOf,
  createToolAppActionPort,
  pendingAppActionStore,
  TurnAppActionSchema,
  type PendingAppAction,
  type PendingAppActionStore,
  type QAppActionPort,
  type QAppActionPrepared,
  type TurnAppAction,
} from "./app-action-turn.js";
export { createToolReadinessLead } from "./readiness-lead.js";

export {
  createToolOpenRecordPort,
  openTarget,
  referenceNote,
  repeatedAction,
  shownItems,
  type LastAction,
  type OpenTarget,
  type QOpenRecordPort,
  type ShownItem,
} from "./references.js";
