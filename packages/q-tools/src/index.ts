/**
 * @capital-q/q-tools
 *
 * Owns: the Capital Q-owned Tool Registry (doc 12 §33) — versioned,
 * source-controlled tool definitions with Zod input and output, risk
 * class, required capabilities, allowed purposes, approval and
 * idempotency semantics and an enabled/disabled status — the
 * deterministic execution pipeline (doc 12 §29; doc 15 §50-52), and the
 * V1 SAFE_READ tools over the owning contexts' public query ports:
 * GET_COMPANY, GET_CAPITAL_OBJECTIVE, GET_INVESTOR_MANDATE and
 * SEARCH_COMPANIES.
 *
 * Does not own: models or providers (the Model Gateway projects these
 * definitions), prompts, the Context Firewall (whose plan every tool
 * obeys), approvals (CQ-Q-008), retrieval, Q knowledge, or any write.
 * There is no SQL tool, no arbitrary HTTP tool and no shell; the only
 * outbound capability here is the bounded public-web research port
 * (CQ-Q-RESEARCH-001), whose queries are composed from allowed words and
 * whose reads are limited to URLs a search in the same run surfaced. An
 * approved MCP server's tool enters this registry only as a definition
 * of its own, with Capital Q's schemas and authorize step, through
 * @capital-q/q-connectors.
 *
 *   tool offered   ≠ tool authorised ≠ tool executed
 *   tool result    ≠ canonical truth ≠ instruction
 *   modality       ≠ authority        (one registry for text and, later, voice)
 *
 * Server-side only.
 */

export {
  allow,
  defineQTool,
  deny,
  NOT_AVAILABLE_MESSAGE,
  Q_TOOL_FAILURE_CODES,
  Q_TOOL_STATUSES,
  QToolArgumentError,
  type AnyQToolDefinition,
  type QToolAuthorization,
  type QToolDefinition,
  type QToolFailureCode,
  type QToolStatus,
} from "./definition.js";
export {
  actorWideScope,
  boundScopeFor,
  planScopeKinds,
  scopesOfKind,
} from "./plan.js";
export type {
  InvestorFeedCompany,
  InvestorFeedDecision,
  InvestorFeedPort,
  ProfileChangePort,
  QToolPorts,
  RelationshipIntelligencePort,
} from "./ports.js";
export {
  createProposeProfileChangeTool,
  FIELDS_BY_PROFILE,
  PROPOSE_PROFILE_CHANGE,
  ProposeProfileChangeInputSchema,
  ProposeProfileChangeOutputSchema,
  type ProposeProfileChangeInput,
  type ProposeProfileChangeOutput,
} from "./tools/profile-change.js";
export {
  createRelationshipTools,
  GET_RELATIONSHIP,
  GetRelationshipInputSchema,
  GetRelationshipOutputSchema,
  LIST_INCOMING_INTEREST,
  ListIncomingInterestOutputSchema,
  PROPOSE_EXPRESS_INTEREST,
  PROPOSE_INTEREST_ANSWER,
  ProposalOutputSchema,
  type GetRelationshipOutput,
} from "./tools/relationships.js";
export {
  createQToolRegistry,
  inputJsonSchemaOf,
  toOfferedTool,
  type QToolRecord,
  type QToolRegistry,
  type QToolVersionId,
} from "./registry.js";
export {
  createQToolExecutor,
  type QToolExecutorDependencies,
} from "./executor.js";
export {
  createGetCompanyTool,
  GET_COMPANY,
  GetCompanyInputSchema,
  GetCompanyOutputSchema,
  type GetCompanyInput,
  type GetCompanyOutput,
} from "./tools/get-company.js";
export {
  createGetCapitalObjectiveTool,
  GET_CAPITAL_OBJECTIVE,
  GetCapitalObjectiveInputSchema,
  GetCapitalObjectiveOutputSchema,
  type GetCapitalObjectiveInput,
  type GetCapitalObjectiveOutput,
} from "./tools/get-capital-objective.js";
export {
  createGetInvestorMandateTool,
  GET_INVESTOR_MANDATE,
  GetInvestorMandateInputSchema,
  GetInvestorMandateOutputSchema,
  type GetInvestorMandateInput,
  type GetInvestorMandateOutput,
} from "./tools/get-investor-mandate.js";
export {
  createSearchCompaniesTool,
  SEARCH_COMPANIES,
  SearchCompaniesInputSchema,
  SearchCompaniesOutputSchema,
  type SearchCompaniesInput,
  type SearchCompaniesOutput,
} from "./tools/search-companies.js";
export { createDefaultQTools, createQTools } from "./default-tools.js";

export {
  createDiscoverySlateTool,
  DISCOVERY_SLATE,
  DiscoverySlateInputSchema,
  DiscoverySlateOutputSchema,
  type DiscoverySlateInput,
  type DiscoverySlateOutput,
} from "./tools/discovery-slate.js";

export {
  createFindProspectiveInvestorsTool,
  FIND_PROSPECTIVE_INVESTORS,
  FindProspectiveInvestorsInputSchema,
  FindProspectiveInvestorsOutputSchema,
  type FindProspectiveInvestorsInput,
  type FindProspectiveInvestorsOutput,
} from "./tools/find-prospective-investors.js";

export {
  createRecommendationExplanationTool,
  RECOMMENDATION_EXPLANATION,
  RecommendationExplanationInputSchema,
  RecommendationExplanationOutputSchema,
  type RecommendationExplanationInput,
  type RecommendationExplanationOutput,
} from "./tools/recommendation-explanation.js";

export {
  ACCEPT_ONBOARDING_RECOMMENDATIONS,
  AcceptOnboardingRecommendationsInputSchema,
  CORRECT_ONBOARDING_ANSWERS,
  CorrectOnboardingAnswersInputSchema,
  type CorrectOnboardingAnswersInput,
  createOnboardingTools,
  FINISH_ONBOARDING,
  FinishOnboardingOutputSchema,
  type FinishOnboardingOutput,
  GET_ONBOARDING_STATE,
  OnboardingRecommendResultSchema,
  RECOMMEND_ONBOARDING_ANSWERS,
  RecommendOnboardingAnswersInputSchema,
  RecommendOnboardingAnswersOutputSchema,
  type AcceptOnboardingRecommendationsInput,
  type OnboardingRecommendResult,
  type RecommendOnboardingAnswersInput,
  type RecommendOnboardingAnswersOutput,
  OnboardingRecordResultSchema,
  OnboardingStateSchema,
  OnboardingStepStateSchema,
  RECORD_ONBOARDING_ANSWERS,
  RecordOnboardingAnswersInputSchema,
  RecordOnboardingAnswersOutputSchema,
  SET_ASIDE_ONBOARDING_STEPS,
  SetAsideOnboardingStepsInputSchema,
  type SetAsideOnboardingStepsInput,
  type OnboardingRecordResult,
  type OnboardingState,
  type OnboardingStepState,
  type OnboardingToolPort,
  type RecordOnboardingAnswersInput,
  type RecordOnboardingAnswersOutput,
} from "./tools/onboarding.js";
export const PACKAGE_NAME = "@capital-q/q-tools" as const;
export {
  createExtractPublicWebTool,
  EXTRACT_PUBLIC_WEB,
  ExtractPublicWebInputSchema,
  ExtractPublicWebOutputSchema,
  type ExtractPublicWebInput,
  type ExtractPublicWebOutput,
} from "./tools/extract-public-web.js";
export {
  createLookupPublicProfileTool,
  LOOKUP_PUBLIC_PROFILE,
  LookupPublicProfileInputSchema,
  LookupPublicProfileOutputSchema,
  type LookupPublicProfileInput,
  type LookupPublicProfileOutput,
} from "./tools/lookup-public-profile.js";
export {
  createResearchPublicWebTool,
  RESEARCH_PUBLIC_WEB,
  ResearchPublicWebInputSchema,
  ResearchPublicWebOutputSchema,
  type ResearchPublicWebInput,
  type ResearchPublicWebOutput,
} from "./tools/research-public-web.js";

export {
  createNotePreferenceTool,
  NOTE_PREFERENCE,
  NotePreferenceInputSchema,
  NotePreferenceOutputSchema,
  type NotePreferenceInput,
  type NotePreferenceOutput,
  type PreferenceNotePort,
} from "./tools/note-preference.js";
