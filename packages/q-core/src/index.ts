/**
 * @capital-q/q-core
 *
 * Owns: Q's governed behavioural core (doc 12 §26; doc 23 §127-129;
 * CQ-Q-006) — the Prompt Registry with its versioned, immutable,
 * provider-neutral definitions (the Q System Charter and the task
 * prompts), their variable and output schemas, the renderer that turns a
 * definition plus already-authorised inputs into a provider-neutral
 * message list with untrusted-content fences, bounded communication
 * guidance, the operating/proactivity mode vocabulary, and prompt bundle
 * identity.
 *
 * Does not own: model execution (model-gateway), the Context Firewall
 * (q-firewall), retrieval (CQ-RAG), tools (CQ-Q-007), approvals
 * (CQ-Q-008), user preference storage (a settings context), or any
 * database. Pure and server-side.
 *
 *   Charter ≠ task prompt ≠ communication profile ≠ operating mode
 *   prompt version ≠ "latest"
 *   system prompt ≠ security boundary
 */

export {
  fenceUntrusted,
  PROMPT_IDS,
  PROMPT_SLUGS,
  promptContentHash,
  PromptRenderError,
  promptVersionId,
  renderTemplate,
  templateVariables,
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
  type PromptDefinition,
  type PromptId,
  type PromptKind,
  type PromptOutputSpec,
  type PromptStatus,
  type PromptVariableSpec,
  type PromptVersionId,
} from "./prompts/definition.js";

export {
  createDefaultPromptRegistry,
  createPromptRegistry,
  PROMPT_DEFINITIONS,
  PromptNotFoundError,
  type PromptRecord,
  type PromptRegistry,
} from "./prompts/registry.js";

export {
  bundleVersionOf,
  renderPrompt,
  type PromptBundle,
  type PromptBundleVersion,
  type RenderedPrompt,
  type RenderRequest,
} from "./prompts/renderer.js";

export {
  Q_SYSTEM_V1,
  QSystemVariablesSchema,
  type QSystemVariables,
} from "./prompts/charter/q-system.v1.js";
export { Q_SYSTEM_VOICE_V1 } from "./prompts/charter/q-system-voice.v1.js";
export {
  Q_PERSONALITIES,
  Q_PERSONALITY_CODES,
  personalityOf,
  type QPersonality,
  type QPersonalityCode,
} from "./personality.js";
export { COMPANY_ANALYST_V1 } from "./prompts/tasks/company-analyst.v1.js";
export { GATEQ_INTERVIEWER_V1 } from "./prompts/tasks/gateq-interviewer.v1.js";
export {
  GATEQ_INTERVIEWER_SCHEMA_NAME,
  GATEQ_INTERVIEWER_SCHEMA_VERSION,
  GATEQ_INTERVIEWER_UNTRUSTED,
  GATEQ_TURN_INTENTS,
  GateQDimensionSchema,
  GateQInterviewerResultSchema,
  GateQInterviewerVariablesSchema,
  GateQProposedFactSchema,
  GateQProposedValueSchema,
  GateQTurnIntentSchema,
  type GateQInterviewerResult,
  type GateQInterviewerVariables,
  type GateQProposedFact,
  type GateQProposedValue,
  type GateQTurnIntent,
} from "./prompts/schemas/gateq-interviewer.js";
export { INTERVIEW_CONDUCTOR_V1 } from "./prompts/tasks/interview-conductor.v1.js";
export { INTERVIEW_CONDUCTOR_V2 } from "./prompts/tasks/interview-conductor.v2.js";
export { INTERVIEW_CONDUCTOR_V3 } from "./prompts/tasks/interview-conductor.v3.js";
export { INTERVIEW_CONDUCTOR_V4 } from "./prompts/tasks/interview-conductor.v4.js";
export { INTERVIEW_CONDUCTOR_V5 } from "./prompts/tasks/interview-conductor.v5.js";
export { INTERVIEW_CONDUCTOR_V6 } from "./prompts/tasks/interview-conductor.v6.js";
export { INTERVIEW_CONDUCTOR_V7 } from "./prompts/tasks/interview-conductor.v7.js";
export { INTERVIEW_CONDUCTOR_V8 } from "./prompts/tasks/interview-conductor.v8.js";
export { INTERVIEW_CONDUCTOR_V9 } from "./prompts/tasks/interview-conductor.v9.js";
export { INTERVIEW_CONDUCTOR_V10 } from "./prompts/tasks/interview-conductor.v10.js";
export { INTERVIEW_CONDUCTOR_V11 } from "./prompts/tasks/interview-conductor.v11.js";
export { DECISION_READER_V1 } from "./prompts/tasks/decision-reader.v1.js";
export { TURN_READER_V1 } from "./prompts/tasks/turn-reader.v1.js";
export { TURN_READER_V2 } from "./prompts/tasks/turn-reader.v2.js";
export { TURN_READER_V3 } from "./prompts/tasks/turn-reader.v3.js";
export {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_SCHEMA_VERSION,
  TURN_READER_UNTRUSTED,
  TURN_READER_V2_SCHEMA_VERSION,
  TURN_READER_V3_SCHEMA_VERSION,
  TURN_DOCUMENT_TYPES,
  TURN_TOOL_V3_KINDS,
  TurnReaderV3ResultSchema,
  TurnToolV3Schema,
  type TurnReaderV3Result,
  type TurnToolV3,
  TURN_TOOL_KINDS,
  TURN_TOOL_VISIBILITIES,
  TurnReaderResultSchema,
  TurnReaderV2ResultSchema,
  TurnReaderVariablesSchema,
  TurnToolSchema,
  type TurnReaderResult,
  type TurnReaderV2Result,
  type TurnTool,
  type TurnReaderVariables,
} from "./prompts/schemas/turn-reader.js";
export {
  DECISION_READER_SCHEMA_NAME,
  DECISION_READER_SCHEMA_VERSION,
  DECISIONS,
  DecisionReaderResultSchema,
  DecisionReaderVariablesSchema,
  type Decision,
  type DecisionReaderResult,
  type DecisionReaderVariables,
} from "./prompts/schemas/decision-reader.js";
export { MEMORY_EXTRACTOR_V1 } from "./prompts/tasks/memory-extractor.v1.js";
export {
  MEMORY_EXTRACT_TYPES,
  MEMORY_EXTRACTOR_SCHEMA_NAME,
  MEMORY_EXTRACTOR_SCHEMA_VERSION,
  MEMORY_KEY_PATTERN,
  MemoryExtractItemSchema,
  MemoryExtractorResultSchema,
  MemoryExtractorVariablesSchema,
  type MemoryExtractItem,
  type MemoryExtractType,
  type MemoryExtractorResult,
  type MemoryExtractorVariables,
} from "./prompts/schemas/memory-extractor.js";
export { WELCOME_CONDUCTOR_V1 } from "./prompts/tasks/welcome-conductor.v1.js";
export { PRESENCE_READER_V1 } from "./prompts/tasks/presence-reader.v1.js";
export {
  PRESENCE_KEY_VALUES,
  PRESENCE_READER_SCHEMA_NAME,
  PRESENCE_READER_SCHEMA_VERSION,
  PRESENCE_READER_UNTRUSTED,
  PresenceReaderResultSchema,
  PresenceReaderVariablesSchema,
  type PresenceReaderResult,
  type PresenceReaderVariables,
} from "./prompts/schemas/presence-reader.js";
export {
  WELCOME_CONDUCTOR_SCHEMA_NAME,
  WELCOME_CONDUCTOR_SCHEMA_VERSION,
  WELCOME_CONDUCTOR_UNTRUSTED,
  WelcomeConductorResultSchema,
  WelcomeConductorVariablesSchema,
  type WelcomeConductorResult,
  type WelcomeConductorVariables,
} from "./prompts/schemas/welcome-conductor.js";
export {
  INTERVIEW_CONDUCTOR_SCHEMA_NAME,
  INTERVIEW_CONDUCTOR_SCHEMA_VERSION,
  INTERVIEW_CONDUCTOR_V4_SCHEMA_VERSION,
  INTERVIEW_CONDUCTOR_V5_SCHEMA_VERSION,
  INTERVIEW_CONDUCTOR_V6_SCHEMA_VERSION,
  INTERVIEW_CONDUCTOR_V7_SCHEMA_VERSION,
  INTERVIEW_CONDUCTOR_V8_UNTRUSTED,
  AnswerClaritySchema,
  type AnswerClarity,
  InterviewConductorResultSchema,
  InterviewConductorV4ResultSchema,
  InterviewConductorV5ResultSchema,
  InterviewConductorV6ResultSchema,
  InterviewConductorV7ResultSchema,
  type InterviewConductorV7Result,
  InterviewConductorV8VariablesSchema,
  type InterviewConductorV6Result,
  type InterviewConductorV8Variables,
  InterviewConductorVariablesSchema,
  InterviewOpenStepSchema,
  type InterviewConductorResult,
  type InterviewConductorV3Result,
  type InterviewConductorV4Result,
  type InterviewConductorV5Result,
  type InterviewConductorVariables,
  type InterviewConductorV3Variables,
  type InterviewConductorV4Variables,
  InterviewConductorV3VariablesSchema,
  InterviewConductorV4VariablesSchema,
  type InterviewOpenStep,
  INTERVIEW_DESTINATIONS,
  InterviewDestinationSchema,
  type InterviewDestination,
} from "./prompts/schemas/interview-conductor.js";
export { COMPANY_ANALYST_V2 } from "./prompts/tasks/company-analyst.v2.js";
export { COMPANY_ANALYST_V3 } from "./prompts/tasks/company-analyst.v3.js";
export { COMPANY_ANALYST_V4 } from "./prompts/tasks/company-analyst.v4.js";
export { COMPANY_ANALYST_V5 } from "./prompts/tasks/company-analyst.v5.js";
export { COMPANY_ANALYST_V6 } from "./prompts/tasks/company-analyst.v6.js";
export { COMPANY_ANALYST_V7 } from "./prompts/tasks/company-analyst.v7.js";
export { COMPANY_ANALYST_V8 } from "./prompts/tasks/company-analyst.v8.js";
export { ARTIFACT_REVISION_V1 } from "./prompts/tasks/artifact-revision.v1.js";
export {
  ARTIFACT_REVISION_BODY_MAX,
  ARTIFACT_REVISION_SCHEMA_NAME,
  ARTIFACT_REVISION_SCHEMA_VERSION,
  ARTIFACT_REVISION_SECTIONS_MAX,
  ARTIFACT_REVISION_UNTRUSTED,
  ArtifactRevisionResultSchema,
  ArtifactRevisionVariablesSchema,
  type ArtifactRevisionResult,
  type ArtifactRevisionVariables,
} from "./prompts/schemas/artifact-revision.js";
export { FOUNDER_ONBOARDING_EXTRACTION_V1 } from "./prompts/tasks/founder-onboarding-extraction.v1.js";
export { FOUNDER_ONBOARDING_EXTRACTION_V2 } from "./prompts/tasks/founder-onboarding-extraction.v2.js";
export { INVESTOR_MANDATE_SYNTHESIS_V1 } from "./prompts/tasks/investor-mandate-synthesis.v1.js";
export { INVESTOR_MANDATE_SYNTHESIS_V2 } from "./prompts/tasks/investor-mandate-synthesis.v2.js";
export { FIT_EXPLANATION_V1 } from "./prompts/tasks/fit-explanation.v1.js";

export {
  AuthorisedFactSchema,
  AuthorisedFactsSchema,
  ClarifyingQuestionSchema,
  ConversationTurnSchema,
  ConversationTurnsSchema,
  ModelFindingSchema,
  ModelStatementSchema,
  TaskFrameSchema,
  type AuthorisedFact,
  type ModelFinding,
} from "./prompts/schemas/common.js";
export {
  COMPANY_ANALYST_SCHEMA_NAME,
  COMPANY_ANALYST_SCHEMA_VERSION,
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V2_SCHEMA_VERSION,
  CompanyAnalystResultSchema,
  CompanyAnalystV2ResultSchema,
  CompanyAnalystV3ResultSchema,
  COMPANY_ANALYST_V3_SCHEMA_VERSION,
  type CompanyAnalystV3Result,
  COMPANY_ANALYST_V4_SCHEMA_VERSION,
  COMPANY_ANALYST_V4_UNTRUSTED,
  COMPANY_ANALYST_V5_SCHEMA_VERSION,
  COMPANY_ANALYST_V6_SCHEMA_VERSION,
  COMPANY_ANALYST_V8_SCHEMA_VERSION,
  COMPANY_ANALYST_V5_UNTRUSTED,
  ARTIFACT_REQUEST_KINDS,
  ARTIFACT_REQUEST_TYPES,
  ARTIFACT_VISUAL_DIRECTIONS,
  ArtifactRequestSchema,
  ArtifactRequestV2Schema,
  CompanyAnalystV5ResultSchema,
  CompanyAnalystV6ResultSchema,
  CompanyAnalystV8ResultSchema,
  CompanyAnalystV5VariablesSchema,
  type ArtifactRequest,
  type ArtifactRequestV2,
  type CompanyAnalystV5Result,
  type CompanyAnalystV6Result,
  type CompanyAnalystV8Result,
  type CompanyAnalystV5Variables,
  CompanyAnalystV4ResultSchema,
  CompanyAnalystV4VariablesSchema,
  DisplayNameRequestSchema,
  NOTHING_REMEMBERED,
  type CompanyAnalystV4Result,
  type CompanyAnalystV4Variables,
  type DisplayNameRequest,
  ProfileUpdateSchema,
  type ProfileUpdate,
  CompanyAnalystV2VariablesSchema,
  CompanyAnalystVariablesSchema,
  type CompanyAnalystResult,
  type CompanyAnalystV2Result,
  type CompanyAnalystV2Variables,
  type CompanyAnalystVariables,
} from "./prompts/schemas/company-analyst.js";
export {
  COMPANY_EVIDENCE_COVERAGE,
  COMPANY_INTELLIGENCE_DIMENSIONS,
  CompanyDimensionCoverageSchema,
  CompanyEvidenceCoverageSchema,
  CompanyIntelligenceDimensionSchema,
  CompanyIntelligenceFindingSchema,
  CompanyIntelligenceModelOutputSchema,
  CompanyMaterialChangeSchema,
  readCitationLabels,
  type CompanyEvidenceCoverage,
  type CompanyIntelligenceDimension,
  type CompanyIntelligenceFinding,
  type CompanyIntelligenceModelOutput,
  type CompanyMaterialChange,
} from "./prompts/schemas/company-intelligence.js";
export {
  CLAIM_ASSERTION_KINDS,
  CLAIM_EXTRACTION_SCHEMA_NAME,
  CLAIM_EXTRACTION_SCHEMA_VERSION,
  CLAIM_EXTRACTION_UNTRUSTED,
  ClaimAssertionKindSchema,
  ClaimExtractionResultSchema,
  ClaimExtractionVariablesSchema,
  ClaimLocatorHintSchema,
  ClaimProposedValueSchema,
  ProposedClaimSchema,
  type ClaimExtractionResult,
  type ClaimExtractionVariables,
  type ClaimProposedValue,
  type ProposedClaim,
} from "./prompts/schemas/claim-extraction.js";
export {
  FOUNDER_EXTRACTION_SCHEMA_NAME,
  FOUNDER_EXTRACTION_SCHEMA_VERSION,
  FOUNDER_FACT_KEYS,
  FounderCandidateFactSchema,
  FounderExtractionResultSchema,
  FounderExtractionV2ResultSchema,
  FounderExtractionV2VariablesSchema,
  FounderExtractionVariablesSchema,
  FounderFactKeySchema,
  FounderSourcePassageSchema,
  FOUNDER_EXTRACTION_V2_SCHEMA_NAME,
  FOUNDER_EXTRACTION_V2_SCHEMA_VERSION,
  type FounderCandidateFact,
  type FounderCandidateFactV2,
  type FounderExtractionResult,
  type FounderExtractionV2Result,
  type FounderExtractionV2Variables,
  type FounderExtractionVariables,
  type FounderFactKey,
  type FounderSourcePassage,
} from "./prompts/schemas/founder-extraction.js";
export {
  DeclaredMandateCandidateSchema,
  InferredPreferenceSchema,
  INVESTOR_MANDATE_SCHEMA_NAME,
  INVESTOR_MANDATE_SCHEMA_VERSION,
  INVESTOR_MANDATE_V2_SCHEMA_NAME,
  INVESTOR_MANDATE_V2_SCHEMA_VERSION,
  InvestorMandateSynthesisResultSchema,
  InvestorMandateSynthesisV2ResultSchema,
  MANDATE_AMBIGUITY_KINDS,
  MANDATE_STRENGTHS,
  MandateAmbiguityKindSchema,
  MandateAmbiguitySchema,
  MandateStrengthSchema,
  InvestorMandateVariablesSchema,
  MANDATE_DIMENSIONS,
  MandateDimensionSchema,
  type DeclaredMandateCandidateV2,
  type InvestorMandateSynthesisResult,
  type InvestorMandateSynthesisV2Result,
  type MandateStrength,
  type InvestorMandateVariables,
  type MandateDimension,
} from "./prompts/schemas/investor-mandate.js";
export {
  FIT_EXPLANATION_SCHEMA_NAME,
  FIT_EXPLANATION_SCHEMA_VERSION,
  FIT_FACTOR_OUTCOMES,
  FitExplanationResultSchema,
  FitExplanationVariablesSchema,
  FitFactorOutcomeSchema,
  FitFactorSchema,
  type FitExplanationResult,
  type FitExplanationVariables,
} from "./prompts/schemas/fit-explanation.js";

export {
  claimsRecommendationExplanation,
  RECOMMENDATION_UNAVAILABLE_MESSAGE,
  withoutRecommendationClaims,
  type GuardedAnswer,
  type RecommendationGrounds,
} from "./communication/recommendation-guard.js";
export {
  citeAuthorisedFacts,
  citePublicSources,
  describePublicSource,
  type CitableFact,
  presentPublicSource,
  type PublicSourceLike,
  type PublicSourcePresentation,
} from "./communication/source-presentation.js";

export {
  COMMUNICATION_FORBIDDEN_TERMS,
  COMMUNICATION_RENDERING_VERSION,
  communicationProfileFor,
  DEFAULT_COMMUNICATION_PROFILE,
  renderCommunicationGuidance,
} from "./communication/guidance.js";

export {
  isPlainLine,
  plainLineProblems,
  type PlainLineProblem,
} from "./communication/plain-lines.js";

export {
  isEmptyPromise,
  stripEmptyPromises,
  type PromiseStripResult,
} from "./communication/promises.js";

export {
  createSentenceCutter,
  type SentenceCutter,
} from "./communication/sentences.js";

export { namesSomething } from "./communication/names-something.js";

export {
  isRecordableKnowledgeKey,
  recordableNamespacesSentence,
  RECORDABLE_KNOWLEDGE_NAMESPACES,
  type RecordableKnowledgeNamespace,
} from "./communication/knowledge-keys.js";

export {
  PRIVATE_CHARTER_MARKER,
  PRIVATE_CONTEXT_MARKER,
  Q_CONVERSATION_SCENARIOS,
  Q_EVAL_TAGS,
  scenarioById,
  SYNTHETIC_COMPANY_FACTS,
  type QConversationScenario,
  type QEvalTag,
} from "./fixtures/index.js";

export const PACKAGE_NAME = "@capital-q/q-core" as const;

export * from "./conversation/index.js";
export {
  deliveryFromCue,
  PLAIN_DELIVERY,
  SPEECH_CUES,
  SPEECH_MAX_SENTENCE_INDEX,
  SPEECH_PACES,
  SPEECH_REACTIONS,
  SpeechCueSchema,
  SpeechDeliverySchema,
  type SpeechCue,
  type SpeechDelivery,
  type SpeechPace,
  type SpeechReaction,
} from "./speech/delivery.js";
