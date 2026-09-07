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
export { COMPANY_ANALYST_V1 } from "./prompts/tasks/company-analyst.v1.js";
export { FOUNDER_ONBOARDING_EXTRACTION_V1 } from "./prompts/tasks/founder-onboarding-extraction.v1.js";
export { INVESTOR_MANDATE_SYNTHESIS_V1 } from "./prompts/tasks/investor-mandate-synthesis.v1.js";
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
  CompanyAnalystResultSchema,
  CompanyAnalystVariablesSchema,
  type CompanyAnalystResult,
  type CompanyAnalystVariables,
} from "./prompts/schemas/company-analyst.js";
export {
  FOUNDER_EXTRACTION_SCHEMA_NAME,
  FOUNDER_EXTRACTION_SCHEMA_VERSION,
  FOUNDER_FACT_KEYS,
  FounderCandidateFactSchema,
  FounderExtractionResultSchema,
  FounderExtractionVariablesSchema,
  FounderFactKeySchema,
  type FounderCandidateFact,
  type FounderExtractionResult,
  type FounderExtractionVariables,
  type FounderFactKey,
} from "./prompts/schemas/founder-extraction.js";
export {
  DeclaredMandateCandidateSchema,
  InferredPreferenceSchema,
  INVESTOR_MANDATE_SCHEMA_NAME,
  INVESTOR_MANDATE_SCHEMA_VERSION,
  InvestorMandateSynthesisResultSchema,
  InvestorMandateVariablesSchema,
  MANDATE_DIMENSIONS,
  MandateDimensionSchema,
  type InvestorMandateSynthesisResult,
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
  COMMUNICATION_FORBIDDEN_TERMS,
  COMMUNICATION_RENDERING_VERSION,
  communicationProfileFor,
  DEFAULT_COMMUNICATION_PROFILE,
  renderCommunicationGuidance,
} from "./communication/guidance.js";

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
