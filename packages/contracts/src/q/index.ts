/**
 * Q contracts (CQ-Q-001, doc 12 §7-9, §37, §44, §70; doc 22 §66-84).
 *
 * The language every client -- Capital Q web, mobile later, GateQ, future
 * partners -- uses to talk to Q, and the language Q uses to answer. It
 * describes capability and product semantics only. There is no LangGraph
 * node, graph checkpoint, provider thread, model name, prompt identifier,
 * specialist name, chain-of-thought or scratchpad anywhere in this surface,
 * and none may be added: implementation frameworks stay behind adapters in
 * the packets that introduce them.
 *
 * Two trust zones share this directory and are named on every type:
 *
 *   PUBLIC    may reach a client. Every public schema is an allowlist; a
 *             response is built by parsing into it, never by serialising an
 *             internal object.
 *   INTERNAL  runtime only. Carries what the Context Firewall, the approval
 *             engine and observability need to decide what may leave.
 *
 * Nothing here executes anything. No model is called, no graph runs, no
 * retrieval occurs, no tool executes, no action executes, no table exists.
 */

export {
  Q_CONTRACT_VERSION,
  QContractVersionSchema,
  type QContractVersion,
} from "./version.js";

export {
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QConversationIdSchema,
  QFindingIdSchema,
  QMessageIdSchema,
  QRunIdSchema,
  QStreamEventIdSchema,
  QToolCallIdSchema,
  type QActionProposalId,
  type QApprovalId,
  type QConversationId,
  type QFindingId,
  type QMessageId,
  type QRunId,
  type QStreamEventId,
  type QToolCallId,
} from "./ids.js";

export {
  Q_CAPABILITIES,
  Q_CLIENT_MODALITIES,
  Q_CONSEQUENCE_CLASSES,
  Q_MODALITIES,
  Q_SOURCE_APPLICATIONS,
  QCapabilitySchema,
  QClientModalitySchema,
  QConsequenceClassSchema,
  QModalitySchema,
  QSourceApplicationSchema,
  type QCapability,
  type QConsequenceClass,
  type QModality,
  type QSourceApplication,
} from "./capability.js";

export {
  Q_SUBJECT_KINDS,
  Q_SUBJECTS_MAX,
  QCapitalObjectiveSubjectSchema,
  QCompanySubjectSchema,
  QDocumentSubjectSchema,
  QInvestorOrganisationSubjectSchema,
  QOrganisationSubjectSchema,
  QRelationshipSubjectSchema,
  QSubjectKindSchema,
  QSubjectRefSchema,
  QSubjectRefsSchema,
  QUserSubjectSchema,
  type QSubjectKind,
  type QSubjectRef,
} from "./subject.js";

export {
  Q_OBJECTIVE_MAX_LENGTH,
  QActorSchema,
  QInteractionSchema,
  QLocaleSchema,
  QPurposeSchema,
  QRequestContextSchema,
  QRequestedKnowledgeScopesSchema,
  QTenantSchema,
  type QActor,
  type QInteraction,
  type QPurpose,
  type QRequestContext,
  type QTenant,
} from "./context.js";

export {
  AppendQRunMessageRequestSchema,
  CreateQRunRequestSchema,
  Q_MESSAGE_TEXT_MAX_LENGTH,
  QRequestEnvelopeSchema,
  QUserMessageInputSchema,
  type AppendQRunMessageRequest,
  type CreateQRunRequest,
  type QRequestEnvelope,
  type QUserMessageInput,
} from "./request.js";

export {
  PermittedContextPlanSchema,
  Q_COMBINATION_EFFECTS,
  Q_CONTEXT_DENIAL_REASONS,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_FACT_CATEGORIES,
  Q_KNOWLEDGE_SCOPE_KINDS,
  Q_PLAN_DENIED_MAX,
  Q_PLAN_SCOPES_MAX,
  Q_RETRIEVAL_LAYERS,
  Q_SCOPE_PROJECTIONS,
  Q_SENSITIVITY_RANK,
  Q_TASK_CLASSES,
  QAuthorisedKnowledgeScopeSchema,
  QCombinationConstraintSchema,
  QContextDenialReasonSchema,
  QContextLabelSchema,
  QDeniedScopeSchema,
  QDisclosureRightsSchema,
  QFactCategorySchema,
  QKnowledgeScopeKindSchema,
  QRetrievalLayerSchema,
  QScopeFilterSchema,
  QScopeProjectionSchema,
  QSensitivityClassSchema,
  QTaskClassSchema,
  sensitivityWithin,
  strongerSensitivity,
  type PermittedContextPlan,
  type QAuthorisedKnowledgeScope,
  type QCombinationConstraint,
  type QContextDenialReason,
  type QContextLabel,
  type QDeniedScope,
  type QDisclosureRights,
  type QFactCategory,
  type QKnowledgeScopeKind,
  type QRetrievalLayer,
  type QScopeFilter,
  type QScopeProjection,
  type QSensitivityClass,
  type QTaskClass,
} from "./firewall.js";

export {
  AppendQRunMessageResponseSchema,
  CreateQRunResponseSchema,
  LAST_EVENT_ID_HEADER,
  LastEventIdHeaderSchema,
  Q_APPROVAL_APPROVE_SUFFIX,
  Q_APPROVAL_REJECT_SUFFIX,
  Q_APPROVALS_PATH,
  Q_RUN_CANCEL_SUFFIX,
  Q_RUN_EVENTS_SUFFIX,
  Q_RUN_MESSAGES_SUFFIX,
  Q_RUNS_PATH,
  Q_SSE_CONTENT_TYPE,
  Q_SSE_MAX_LAST_EVENT_ID,
  type AppendQRunMessageResponse,
  type CreateQRunResponse,
} from "./http.js";

export {
  isTerminalQRunStatus,
  Q_RUN_MESSAGES_MAX,
  Q_RUN_STATUSES,
  Q_RUN_TERMINAL_STATUSES,
  Q_RUN_WAITING_STATUSES,
  QRunHandleSchema,
  QRunStatusSchema,
  QRunSummarySchema,
  QRunTerminalStatusSchema,
  type QRunHandle,
  type QRunStatus,
  type QRunSummary,
  type QRunTerminalStatus,
} from "./run.js";

export {
  Q_VISIBLE_STAGE_LABELS,
  Q_VISIBLE_STAGES,
  qVisibleStageLabel,
  QVisibleStageSchema,
  type QVisibleStage,
} from "./stage.js";

export {
  Q_MESSAGE_ROLES,
  Q_RESPONSE_TEXT_MAX_LENGTH,
  QMessageRoleSchema,
  QMessageSchema,
  QResponseMessageSchema,
  QUserMessageSchema,
  type QMessage,
  type QMessageRole,
  type QResponseMessage,
  type QUserMessage,
} from "./message.js";

export {
  Q_CONFIDENCE_LABELS,
  Q_CONFIDENCE_LEVELS,
  Q_UNCERTAIN_CONFIDENCE_LEVELS,
  qConfidenceLabel,
  QConfidenceLevelSchema,
  QUncertainConfidenceLevelSchema,
  type QConfidenceLevel,
} from "./confidence.js";

export {
  Q_EVIDENCE_REF_KINDS,
  Q_EVIDENCE_REFS_MAX,
  QClaimRefSchema,
  QDocumentRefSchema,
  QEvidenceItemRefSchema,
  QEvidenceRefKindSchema,
  QEvidenceRefSchema,
  QEvidenceRefsSchema,
  QSourceRefSchema,
  type QEvidenceRef,
  type QEvidenceRefKind,
} from "./evidence-ref.js";

export {
  Q_FINDING_ASSUMPTION_MAX_LENGTH,
  Q_FINDING_ASSUMPTIONS_MAX,
  Q_FINDING_STATEMENT_MAX_LENGTH,
  Q_FINDING_TYPES,
  QFindingTypeSchema,
  QInternalFindingSchema,
  QPublicFindingSchema,
  type QFindingType,
  type QInternalFinding,
  type QPublicFinding,
} from "./finding.js";

export {
  Q_CLARIFICATION_OPTION_MAX_LENGTH,
  Q_CLARIFICATION_OPTIONS_MAX,
  Q_CLARIFICATION_OPTIONS_MIN,
  Q_CLARIFICATION_QUESTION_MAX_LENGTH,
  Q_COMPARISON_LABEL_MAX_LENGTH,
  Q_COMPARISON_ROWS_MAX,
  Q_COMPARISON_VALUE_MAX_LENGTH,
  Q_RESULT_BLOCK_KINDS,
  Q_RESULT_BLOCKS_MAX,
  Q_TEXT_BLOCK_MAX_LENGTH,
  Q_UNCERTAINTY_MISSING_ITEM_MAX_LENGTH,
  Q_UNCERTAINTY_MISSING_MAX,
  Q_UNCERTAINTY_STATEMENT_MAX_LENGTH,
  QActionProposalBlockSchema,
  QClarificationRequestBlockSchema,
  QCompanyReferenceBlockSchema,
  QComparisonBlockSchema,
  QEvidenceBlockSchema,
  QFindingBlockSchema,
  QInvestorReferenceBlockSchema,
  QResultBlockKindSchema,
  QResultBlockSchema,
  QResultBlocksSchema,
  QTextBlockSchema,
  QUiIntentBlockSchema,
  QUncertaintyBlockSchema,
  type QResultBlock,
  type QResultBlockKind,
} from "./result-block.js";

export {
  Q_COMPARISON_SUBJECTS_MAX,
  Q_COMPARISON_SUBJECTS_MIN,
  Q_UI_COMPANY_SECTIONS,
  Q_UI_INTENT_KINDS,
  QFocusSectionIntentSchema,
  QOpenCompanyIntentSchema,
  QShowComparisonIntentSchema,
  QShowEvidenceIntentSchema,
  QUiCompanySectionSchema,
  QUiIntentKindSchema,
  QUiIntentSchema,
  type QUiCompanySection,
  type QUiIntent,
  type QUiIntentKind,
} from "./ui-intent.js";

export {
  isTerminalQToolCallStatus,
  Q_TOOL_CALL_STATUSES,
  Q_TOOL_CALL_TERMINAL_STATUSES,
  Q_TOOL_CLASSIFICATIONS,
  QToolCallRecordSchema,
  QToolCallStatusSchema,
  QToolClassificationSchema,
  QToolFailureCodeSchema,
  QToolNameSchema,
  QToolProgressSchema,
  type QToolCallRecord,
  type QToolCallStatus,
  type QToolClassification,
  type QToolName,
  type QToolProgress,
} from "./tool.js";

export {
  isTerminalQActionStatus,
  Q_ACTION_BINDING_VERSION,
  Q_ACTION_CLASSES,
  Q_ACTION_PREVIEW_MAX_LENGTH,
  Q_ACTION_PROPOSAL_STATUSES,
  Q_ACTION_STATUSES,
  Q_ACTION_SUMMARY_MAX_LENGTH,
  Q_ACTION_TERMINAL_STATUSES,
  Q_APPROVAL_REQUIRED_ACTION_CLASSES,
  Q_APPROVAL_STATUSES,
  QActionBindingEnvelopeSchema,
  QActionClassSchema,
  QActionPayloadHashSchema,
  QActionProposalSchema,
  QActionProposalStatusSchema,
  QActionStatusSchema,
  QActionTypeSchema,
  QActionVersionSchema,
  QApprovalRefSchema,
  QApprovalRequirementSchema,
  QApprovalStatusSchema,
  type QActionBindingEnvelope,
  type QActionClass,
  type QActionPayloadHash,
  type QActionProposal,
  type QActionProposalStatus,
  type QActionStatus,
  type QActionType,
  type QApprovalRef,
  type QApprovalRequirement,
  type QApprovalStatus,
} from "./action.js";

export {
  ApproveQApprovalRequestSchema,
  Q_APPROVAL_REJECTION_REASON_MAX_LENGTH,
  QApprovalActionViewSchema,
  QApprovalViewSchema,
  RejectQApprovalRequestSchema,
  type ApproveQApprovalRequest,
  type QApprovalActionView,
  type QApprovalView,
  type RejectQApprovalRequest,
} from "./approval.js";

export {
  Q_FAILURE_DETAIL_MAX_LENGTH,
  Q_FAILURE_DIAGNOSTIC_CODES,
  Q_PUBLIC_FAILURE_CODES,
  Q_PUBLIC_FAILURE_MESSAGE_MAX_LENGTH,
  Q_PUBLIC_FAILURE_MESSAGES,
  QFailureDiagnosticCodeSchema,
  QPublicFailureCodeSchema,
  QPublicFailureSchema,
  QRunFailureSchema,
  toPublicQFailure,
  type QFailureDiagnosticCode,
  type QPublicFailure,
  type QPublicFailureCode,
  type QPublicFailureRefs,
  type QRunFailure,
  type QRunFailureLike,
} from "./failure.js";

export {
  isDurableQStreamEvent,
  isDurableQStreamEventType,
  isTerminalQStreamEvent,
  Q_STREAM_DELTA_MAX_LENGTH,
  Q_STREAM_DURABLE_EVENT_TYPES,
  Q_STREAM_EPHEMERAL_EVENT_TYPES,
  Q_STREAM_EVENT_TYPES,
  Q_STREAM_TERMINAL_EVENT_TYPES,
  QActionProposedEventSchema,
  QApprovalRequiredEventSchema,
  QFindingAvailableEventSchema,
  QInputRequiredEventSchema,
  QMessageCompletedEventSchema,
  QMessageDeltaEventSchema,
  QRunCompletedEventSchema,
  QRunFailedEventSchema,
  QRunStartedEventSchema,
  QStageChangedEventSchema,
  QStreamEventSchema,
  QStreamEventTypeSchema,
  QStreamSequenceSchema,
  type QStreamEvent,
  type QStreamEventType,
} from "./stream.js";

export {
  Q_CHALLENGE_LEVELS,
  Q_COMMUNICATION_PRESETS,
  Q_COMMUNICATION_PROFILES,
  Q_DEFAULT_COMMUNICATION_PRESET,
  Q_EXPLANATION_STYLES,
  Q_OPERATING_MODES,
  Q_PROACTIVITY_MODES,
  Q_QUESTION_STYLES,
  Q_RESPONSE_DEPTHS,
  Q_TONES,
  QChallengeLevelSchema,
  QCommunicationPresetSchema,
  QCommunicationProfileSchema,
  QExplanationStyleSchema,
  QOperatingModeSchema,
  QProactivityModeSchema,
  QQuestionStyleSchema,
  QResponseDepthSchema,
  QToneSchema,
  type QChallengeLevel,
  type QCommunicationPreset,
  type QCommunicationProfile,
  type QExplanationStyle,
  type QOperatingMode,
  type QProactivityMode,
  type QQuestionStyle,
  type QResponseDepth,
  type QTone,
} from "./communication.js";
