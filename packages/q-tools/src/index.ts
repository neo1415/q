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
  ConversationProposal,
  HandleClaimPort,
  PendingProposalContext,
  PendingProposalPort,
  QCardReadPort,
  ProfileChangePort,
  ProposalPlainStatus,
  ApprovalInboxPort,
  DiscoveryDecisionPort,
  EvidenceDocumentsPort,
  OwnRecordKind,
  OwnRecordsPort,
  RecordChange,
  RecordChangePort,
  RelationshipMailPort,
  OwnDocumentsPort,
  QToolPorts,
  PitchMomentPort,
  RelationshipIntelligencePort,
  OwnRelationship,
  OwnRelationships,
  EmailIntelligencePort,
  VisibilityIntelligencePort,
} from "./ports.js";
export {
  createClientActionTools,
  createOpenWebsiteTool,
  createReloadPageTool,
  createSetThemeTool,
  createSetQMotionTool,
  createSetVoiceTool,
  createSignOutTool,
  SET_Q_MOTION,
  SET_VOICE,
  SIGN_OUT,
  OPEN_PAGE,
  createOpenPageTool,
  SET_DISCOVER_FILTERS,
  SetDiscoverFiltersInputSchema,
  createSetDiscoverFiltersTool,
  type SetDiscoverFiltersInput,
  OPEN_WEBSITE,
  OpenWebsiteInputSchema,
  RELOAD_PAGE,
  SET_THEME,
  SetThemeInputSchema,
  siteHost,
} from "./tools/client-actions.js";
export {
  CONTINUE_ONBOARDING,
  ContinueOnboardingInputSchema,
  createContinueOnboardingTool,
  createOnboardingReminderTools,
  createSetOnboardingRemindersTool,
  SET_ONBOARDING_REMINDERS,
  SetOnboardingRemindersInputSchema,
  SetOnboardingRemindersOutputSchema,
  type OnboardingRemindersPort,
} from "./tools/onboarding-reminders.js";
export {
  createGetQCardTool,
  GET_Q_CARD,
  GetQCardInputSchema,
  GetQCardOutputSchema,
  type GetQCardOutput,
} from "./tools/q-card.js";
export {
  createProposeHandleClaimTool,
  PROPOSE_HANDLE_CLAIM,
  ProposeHandleClaimInputSchema,
  ProposeHandleClaimOutputSchema,
  type ProposeHandleClaimInput,
  type ProposeHandleClaimOutput,
} from "./tools/handle-claim.js";
export { OWN_RECORD_KINDS, PROPOSAL_PLAIN_STATUSES } from "./ports.js";
export {
  APPROVE_PENDING_OUTCOMES,
  APPROVE_PENDING_PROPOSAL,
  ApprovePendingProposalInputSchema,
  ApprovePendingProposalOutputSchema,
  createApprovePendingProposalTool,
  type ApprovePendingProposalInput,
  type ApprovePendingProposalOutput,
  createDeclinePendingProposalTool,
  DECLINE_PENDING_OUTCOMES,
  DECLINE_PENDING_PROPOSAL,
  DeclinePendingProposalOutputSchema,
  type DeclinePendingProposalOutput,
} from "./tools/pending-proposal.js";
export {
  createDiscoveryDecisionTool,
  createListMyDocumentsTool,
  createListPendingApprovalsTool,
  createOwnWorkTools,
  decisionEventId,
  LIST_MY_DOCUMENTS,
  LIST_PENDING_APPROVALS,
  PASS_COMPANY,
  SAVE_COMPANY,
  UNSAVE_COMPANY,
} from "./tools/own-work.js";
export {
  createListUploadedDocumentsTool,
  createOwnRecordTools,
  createReadMyRecordTool,
  createReadRelationshipEmailTool,
  createReassessReadinessTool,
  LIST_UPLOADED_DOCUMENTS,
  READ_MY_RECORD,
  READ_RELATIONSHIP_EMAIL,
  REASSESS_READINESS,
} from "./tools/own-records.js";
export {
  createProposeInvestorVisibilityTool,
  createProposeMandateChangeTool,
  createProposeQCardChangeTool,
  createProposeRaiseChangeTool,
  createProposeTeamChangeTool,
  createRecordChangeTools,
  ProposeRecordChangeOutputSchema,
  PROPOSE_INVESTOR_VISIBILITY,
  PROPOSE_MANDATE_CHANGE,
  PROPOSE_Q_CARD_CHANGE,
  PROPOSE_RAISE_CHANGE,
  PROPOSE_TEAM_CHANGE,
} from "./tools/record-changes.js";
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
  LIST_MY_RELATIONSHIPS,
  ListIncomingInterestOutputSchema,
  ListMyRelationshipsOutputSchema,
  type ListMyRelationshipsOutput,
  PROPOSE_EXPRESS_INTEREST,
  PROPOSE_INTEREST_ANSWER,
  ProposalOutputSchema,
  type GetRelationshipOutput,
} from "./tools/relationships.js";
// R34: relationship chat tools.
export {
  CHAT_MESSAGE_SEND,
  ChatProposalOutputSchema,
  createChatTools,
  LIST_MESSAGES,
  ListMessagesInputSchema,
  ListMessagesOutputSchema,
  MEETING_CANCEL,
  MEETING_RESCHEDULE,
  MEETING_SCHEDULE,
  PROPOSE_CHAT_MESSAGE,
  PROPOSE_MEETING,
  PROPOSE_REMINDER,
  ProposeChatMessageInputSchema,
  REMINDER_CREATE,
  type ChatIntelligencePort,
  type ChatProposal,
  type ChatProposalOutput,
  type ListMessagesInput,
  type ListMessagesOutput,
  type ProposeChatMessageInput,
} from "./tools/chat.js";
// BIZ-008: meetings and reminders.
export {
  createScheduleTools,
  FIND_MEETING_TIMES,
  FindMeetingTimesInputSchema,
  FindMeetingTimesOutputSchema,
  LIST_SCHEDULE,
  PROPOSE_MEETING_CHANGE,
  ProposeMeetingChangeInputSchema,
  ProposeMeetingInputSchema,
  ProposeReminderInputSchema,
  type ProposeMeetingChangeInput,
  type ProposeMeetingInput,
  type ProposeReminderInput,
  type ScheduleIntelligencePort,
} from "./tools/schedule.js";
export {
  createProposeEmailTool,
  PROPOSE_EMAIL,
  ProposeEmailInputSchema,
  ProposeEmailOutputSchema,
  type ProposeEmailInput,
  type ProposeEmailOutput,
} from "./tools/email.js";
export {
  GET_PITCH_MOMENT,
  GetPitchMomentInputSchema,
  GetPitchMomentOutputSchema,
  viewedPitchIn,
  type GetPitchMomentOutput,
} from "./tools/pitch-moment.js";
export {
  GET_DISCLOSURE_STATE,
  GetDisclosureStateOutputSchema,
  PROPOSE_REVOKE_SHARE,
  PROPOSE_SHARE_RAISE,
  type GetDisclosureStateOutput,
} from "./tools/visibility.js";
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
  CONFIRM_ONBOARDING_AS_STATED,
  ConfirmOnboardingAsStatedInputSchema,
  type ConfirmOnboardingAsStatedInput,
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

export {
  eligibleCapabilities,
  HOME_Q_CAPABILITY_GROUPS,
  Q_CAPABILITIES,
  Q_CAPABILITY_EXCLUSIONS,
  Q_CAPABILITY_GROUPS,
  type QCapability,
  type QCapabilityApproval,
  type QCapabilityGroup,
  type QCapabilityHand,
  type QCapabilityRunFacts,
  type QCapabilitySurface,
} from "./capabilities.js";
