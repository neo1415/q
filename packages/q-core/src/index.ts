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
export { INTERVIEW_AGENT_V1 } from "./prompts/tasks/interview-agent.v1.js";
export { INTERVIEW_AGENT_V2 } from "./prompts/tasks/interview-agent.v2.js";
export { INTERVIEW_AGENT_V3 } from "./prompts/tasks/interview-agent.v3.js";
export { INTERVIEW_AGENT_V4 } from "./prompts/tasks/interview-agent.v4.js";
export { INTERVIEW_AGENT_V5 } from "./prompts/tasks/interview-agent.v5.js";
export { INTERVIEW_AGENT_V6 } from "./prompts/tasks/interview-agent.v6.js";
export { INTERVIEW_AGENT_V7 } from "./prompts/tasks/interview-agent.v7.js";
export { INTERVIEW_AGENT_V8 } from "./prompts/tasks/interview-agent.v8.js";
export { INTERVIEW_AGENT_V9 } from "./prompts/tasks/interview-agent.v9.js";
export { INTERVIEW_AGENT_V10 } from "./prompts/tasks/interview-agent.v10.js";
export { INTERVIEW_AGENT_V11 } from "./prompts/tasks/interview-agent.v11.js";
export { INTERVIEW_AGENT_V12 } from "./prompts/tasks/interview-agent.v12.js";
export { INTERVIEW_AGENT_V13 } from "./prompts/tasks/interview-agent.v13.js";
export { INTERVIEW_AGENT_V14 } from "./prompts/tasks/interview-agent.v14.js";
export { INTERVIEW_AGENT_V15 } from "./prompts/tasks/interview-agent.v15.js";
export { INTERVIEW_AGENT_V16 } from "./prompts/tasks/interview-agent.v16.js";
export { DELEGATION_READER_V1 } from "./prompts/tasks/delegation-reader.v1.js";
export { DELEGATION_READER_V2 } from "./prompts/tasks/delegation-reader.v2.js";
export { DELEGATION_READER_V3 } from "./prompts/tasks/delegation-reader.v3.js";
export { DELEGATION_READER_V4 } from "./prompts/tasks/delegation-reader.v4.js";
export { DELEGATION_READER_V5 } from "./prompts/tasks/delegation-reader.v5.js";
export {
  DELEGATION_READER_SCHEMA_NAME,
  DELEGATION_READER_SCHEMA_VERSION,
  DelegationReaderResultSchema,
  DelegationReaderV2ResultSchema,
  DelegationReaderV3ResultSchema,
  type DelegationReaderV3Result,
  DelegationReaderV2VariablesSchema,
  DelegationReaderV4VariablesSchema,
  type DelegationReaderV4Variables,
  DelegationReaderVariablesSchema,
  type DelegationReaderResult,
  type DelegationReaderV2Result,
  type DelegationReaderV2Variables,
  type DelegationReaderVariables,
} from "./prompts/schemas/delegation-reader.js";
export {
  INTERVIEW_AGENT_SCHEMA_NAME,
  INTERVIEW_AGENT_SCHEMA_VERSION,
  InterviewAgentResultSchema,
  InterviewAgentV3VariablesSchema,
  InterviewAgentV5VariablesSchema,
  InterviewAgentV6VariablesSchema,
  InterviewAgentV7VariablesSchema,
  InterviewAgentV9VariablesSchema,
  InterviewAgentV11ResultSchema,
  InterviewAgentV16ResultSchema,
  InterviewAgentV11VariablesSchema,
  InterviewAgentVariablesSchema,
  type InterviewAgentResult,
  type InterviewAgentV11Result,
  type InterviewAgentV16Result,
  type InterviewAgentV11Variables,
  type InterviewAgentV3Variables,
  type InterviewAgentV5Variables,
  type InterviewAgentV6Variables,
  type InterviewAgentV7Variables,
  type InterviewAgentV9Variables,
  type InterviewAgentVariables,
} from "./prompts/schemas/interview-agent.js";
export { DECISION_READER_V1 } from "./prompts/tasks/decision-reader.v1.js";
export { TURN_READER_V1 } from "./prompts/tasks/turn-reader.v1.js";
export { TURN_READER_V2 } from "./prompts/tasks/turn-reader.v2.js";
export { TURN_READER_V3 } from "./prompts/tasks/turn-reader.v3.js";
export { TURN_READER_V4 } from "./prompts/tasks/turn-reader.v4.js";
export { TURN_READER_V5 } from "./prompts/tasks/turn-reader.v5.js";
export { TURN_READER_V6 } from "./prompts/tasks/turn-reader.v6.js";
export { TURN_READER_V7 } from "./prompts/tasks/turn-reader.v7.js";
export { TURN_READER_V8 } from "./prompts/tasks/turn-reader.v8.js";
export { TURN_READER_V9 } from "./prompts/tasks/turn-reader.v9.js";
export { TURN_READER_V10 } from "./prompts/tasks/turn-reader.v10.js";
export { TURN_READER_V11 } from "./prompts/tasks/turn-reader.v11.js";
export { TURN_READER_V12 } from "./prompts/tasks/turn-reader.v12.js";
export { TURN_READER_V13 } from "./prompts/tasks/turn-reader.v13.js";
export { TURN_READER_V14 } from "./prompts/tasks/turn-reader.v14.js";
export { TURN_READER_V15 } from "./prompts/tasks/turn-reader.v15.js";
export {
  TURN_READER_V16,
  TURN_READER_V16_RECORDS,
} from "./prompts/tasks/turn-reader.v16.js";
export { TURN_READER_V17 } from "./prompts/tasks/turn-reader.v17.js";
export { TURN_READER_V18 } from "./prompts/tasks/turn-reader.v18.js";
export { TURN_READER_V19 } from "./prompts/tasks/turn-reader.v19.js";
export { TURN_READER_V20 } from "./prompts/tasks/turn-reader.v20.js";
export { TURN_READER_V21 } from "./prompts/tasks/turn-reader.v21.js";
export {
  TURN_READER_V22,
  TURN_READER_V22_HAND_OVER,
} from "./prompts/tasks/turn-reader.v22.js";
export {
  TURN_READER_V23,
  TURN_READER_V23_HAND_OVER,
} from "./prompts/tasks/turn-reader.v23.js";
export {
  TURN_READER_V24,
  TURN_READER_V24_ADDRESSED,
} from "./prompts/tasks/turn-reader.v24.js";
export {
  TURN_READER_V25,
  TURN_READER_V25_END_VOICE,
} from "./prompts/tasks/turn-reader.v25.js";
export {
  TURN_READER_V26,
  TURN_READER_V26_HAND_OVER,
} from "./prompts/tasks/turn-reader.v26.js";
export {
  TURN_READER_V27,
  TURN_READER_V27_SAVE_TO_PROFILE,
} from "./prompts/tasks/turn-reader.v27.js";
export {
  TURN_READER_V28,
  TURN_READER_V28_DIRECT,
} from "./prompts/tasks/turn-reader.v28.js";
export {
  TURN_READER_V29,
  TURN_READER_V29_DESTINATIONS,
} from "./prompts/tasks/turn-reader.v29.js";
export {
  TURN_READER_V30,
  TURN_READER_V30_ASKED_ACTION,
} from "./prompts/tasks/turn-reader.v30.js";
export {
  TURN_READER_V31,
  TURN_READER_V31_APP_ACTION,
} from "./prompts/tasks/turn-reader.v31.js";
export {
  TURN_READER_V32,
  TURN_READER_V32_ACTIONS,
} from "./prompts/tasks/turn-reader.v32.js";
export {
  TURN_READER_V33,
  TURN_READER_V33_TAIL,
} from "./prompts/tasks/turn-reader.v33.js";
export { TURN_READER_V34 } from "./prompts/tasks/turn-reader.v34.js";
export { TURN_READER_V35 } from "./prompts/tasks/turn-reader.v35.js";
export { TURN_READER_V36 } from "./prompts/tasks/turn-reader.v36.js";
export { TURN_READER_V37 } from "./prompts/tasks/turn-reader.v37.js";
export {
  TURN_READER_V38,
  TURN_READER_V38_DESTINATIONS,
} from "./prompts/tasks/turn-reader.v38.js";
export {
  TURN_READER_V39,
  TURN_READER_V39_TOOL_REQUEST,
} from "./prompts/tasks/turn-reader.v39.js";
export {
  TURN_READER_V40,
  TURN_READER_V40_DESTINATIONS,
  TURN_READER_V40_REFERENCES,
} from "./prompts/tasks/turn-reader.v40.js";
export {
  TURN_READER_V41,
  TURN_READER_V41_DESTINATIONS,
} from "./prompts/tasks/turn-reader.v41.js";
export {
  TURN_READER_V42,
  TURN_READER_V42_MESSY_WORDS,
} from "./prompts/tasks/turn-reader.v42.js";
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
  TURN_DOCUMENT_TYPES_V5,
  TURN_READER_V5_SCHEMA_VERSION,
  TurnReaderV5ResultSchema,
  TurnReaderV7VariablesSchema,
  type TurnReaderV7Variables,
  TURN_READER_V8_SCHEMA_VERSION,
  TurnReaderV8ResultSchema,
  TurnToolV8Schema,
  TurnUnknownScreenSchema,
  type TurnReaderV8Result,
  type TurnToolV8,
  type TurnUnknownScreen,
  TURN_READER_MORE_DOCUMENTS_MAX,
  TURN_READER_V9_SCHEMA_VERSION,
  TurnReaderV9ResultSchema,
  type TurnReaderV9Result,
  TURN_READER_V11_SCHEMA_VERSION,
  TurnReaderV11ResultSchema,
  type TurnReaderV11Result,
  TURN_DOCUMENT_TYPES_V14,
  TURN_READER_V14_SCHEMA_VERSION,
  TurnReaderV14ResultSchema,
  TurnReaderV15ResultSchema,
  TURN_HAND_OVER_KINDS,
  TURN_READER_V22_SCHEMA_VERSION,
  TurnHandOverSchema,
  TurnReaderV22ResultSchema,
  TURN_READER_V24_SCHEMA_VERSION,
  TurnReaderV24ResultSchema,
  TURN_READER_V25_SCHEMA_VERSION,
  TurnReaderV25ResultSchema,
  type TurnReaderV25Result,
  TURN_READER_V27_SCHEMA_VERSION,
  TurnReaderV27ResultSchema,
  type TurnReaderV27Result,
  TURN_READER_V28_SCHEMA_VERSION,
  TURN_READER_V30_SCHEMA_VERSION,
  TURN_READER_V31_SCHEMA_VERSION,
  TurnAppActionSchema,
  TurnReaderV31ResultSchema,
  type TurnAppAction,
  type TurnReaderV31Result,
  TURN_READER_V40_SCHEMA_VERSION,
  TURN_REFERENCE_OPEN_KINDS,
  TurnReaderV40ResultSchema,
  TurnReferenceSchema,
  type TurnReaderV40Result,
  type TurnReference,
  type TurnReferenceOpenKind,
  TurnReaderV30ResultSchema,
  type TurnReaderV30Result,
  TurnReaderV28ResultSchema,
  TurnTimeWindowSchema,
  type TurnReaderV28Result,
  type TurnTimeWindow,
  type TurnReaderV24Result,
  type TurnHandOver,
  type TurnReaderV22Result,
  TurnToolV14Schema,
  type TurnDocumentTypeV14,
  type TurnReaderV14Result,
  type TurnReaderV15Result,
  type TurnToolV14,
  TurnToolV5Schema,
  type TurnReaderV5Result,
  type TurnToolV5,
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
export { MEETING_NOTES_V1 } from "./prompts/tasks/meeting-notes.v1.js";
export { MEETING_NOTES_V2 } from "./prompts/tasks/meeting-notes.v2.js";
export { MEETING_NOTES_V3 } from "./prompts/tasks/meeting-notes.v3.js";
export { ERRAND_REPLY_V1 } from "./prompts/tasks/errand-reply.v1.js";
export { DILIGENCE_DOCUMENT_SUMMARY_V1 } from "./prompts/tasks/diligence-document-summary.v1.js";
export { INVESTOR_PERSONA_V1 } from "./prompts/tasks/investor-persona.v1.js";
export { INVESTOR_TWIN_TURN_V1 } from "./prompts/tasks/investor-twin-turn.v1.js";
export { REHEARSAL_SCORE_V1 } from "./prompts/tasks/rehearsal-score.v1.js";
// REHEARSE block (2026-10-01)
export { INVESTOR_PERSONA_V2 } from "./prompts/tasks/investor-persona.v2.js";
export { INVESTOR_TWIN_TURN_V2 } from "./prompts/tasks/investor-twin-turn.v2.js";
export { REHEARSAL_SCORE_V2 } from "./prompts/tasks/rehearsal-score.v2.js";
export { INVESTOR_TWIN_TURN_V3 } from "./prompts/tasks/investor-twin-turn.v3.js";
export { INVESTOR_TWIN_TURN_V4 } from "./prompts/tasks/investor-twin-turn.v4.js";
export { INVESTOR_PERSONA_V3 } from "./prompts/tasks/investor-persona.v3.js";
export { INVESTOR_PERSONA_V4 } from "./prompts/tasks/investor-persona.v4.js";
export { INVESTOR_PERSONA_V5 } from "./prompts/tasks/investor-persona.v5.js";
export {
  INVESTOR_PERSONA_V6,
  INVESTOR_PERSONA_V6_CONDUCT,
} from "./prompts/tasks/investor-persona.v6.js";
export { INVESTOR_TWIN_TURN_V5 } from "./prompts/tasks/investor-twin-turn.v5.js";
export { INVESTOR_TWIN_TURN_V6 } from "./prompts/tasks/investor-twin-turn.v6.js";
export { INVESTOR_TWIN_TURN_V7 } from "./prompts/tasks/investor-twin-turn.v7.js";
export { INVESTOR_TWIN_TURN_V8 } from "./prompts/tasks/investor-twin-turn.v8.js";
export { INVESTOR_TWIN_TURN_V9 } from "./prompts/tasks/investor-twin-turn.v9.js";
// MEET-HOST block (ADR 0037)
export { MEETING_HOST_TURN_V1 } from "./prompts/tasks/meeting-host-turn.v1.js";
export { MEETING_HOST_TURN_V2 } from "./prompts/tasks/meeting-host-turn.v2.js";
export {
  MEETING_HOST_SCHEMA_NAME,
  MEETING_HOST_SCHEMA_VERSION,
  MEETING_HOST_UNTRUSTED,
  MeetingHostResultSchema,
  MeetingHostVariablesSchema,
  type MeetingHostResult,
  MEETING_HOST_KINDS,
  MeetingHostResultV2Schema,
  type MeetingHostResultV2,
  type MeetingHostVariables,
} from "./prompts/schemas/meeting-host.js";
// end MEET-HOST block
export { REHEARSAL_SCORE_V3 } from "./prompts/tasks/rehearsal-score.v3.js";
export { REHEARSAL_SCORE_V4 } from "./prompts/tasks/rehearsal-score.v4.js";
export {
  REHEARSAL_SCORE_V5,
  REHEARSAL_SCORE_V5_RULE,
} from "./prompts/tasks/rehearsal-score.v5.js";
export {
  REHEARSAL_CONCLUSIONS,
  REHEARSAL_CUES,
  REHEARSAL_CUES_V3,
  REHEARSAL_DIMENSIONS_FOR,
  REHEARSAL_APPRAISALS_V4,
  REHEARSAL_LINE_MOODS_V4,
  RehearsalTurnV4ResultSchema,
  RehearsalTurnV4VariablesSchema,
  RehearsalTurnV5VariablesSchema,
  RehearsalTurnV6VariablesSchema,
  RehearsalTurnV5ResultSchema,
  RehearsalTurnV6ResultSchema,
  RehearsalTurnV7ResultSchema,
  type RehearsalTurnV7Result,
  type RehearsalTurnV6Result,
  PresenceReadingSchema,
  type PresenceReading,
  type RehearsalTurnV6Variables,
  type RehearsalTurnV5Result,
  type RehearsalTurnV5Variables,
  type RehearsalTurnV4Result,
  type RehearsalTurnV4Variables,
  RehearsalReviewLenientSchema,
  normaliseRehearsalReview,
  type RehearsalReviewLenient,
  REHEARSAL_DIFFICULTIES,
  REHEARSAL_LINE_MOODS_V3,
  RehearsalTurnV3ResultSchema,
  RehearsalTurnV3VariablesSchema,
  type RehearsalTurnV3Result,
  type RehearsalTurnV3Variables,
  REHEARSAL_DIMENSIONS,
  REHEARSAL_LINE_MOODS,
  REHEARSAL_MOVES,
  RehearsalReviewResultSchema,
  RehearsalReviewVariablesSchema,
  RehearsalTurnResultSchema,
  RehearsalTurnVariablesSchema,
  type RehearsalReviewResult,
  type RehearsalReviewVariables,
  type RehearsalTurnResult,
  type RehearsalTurnVariables,
} from "./prompts/schemas/rehearsal.js";
export {
  CounterpartPersonaLenientSchema,
  CounterpartPersonaResultSchema,
  CounterpartPersonaVariablesSchema,
  normaliseCounterpartPersona,
  normaliseCounterpartPersonaV4,
  CounterpartPersonaStoredSchema,
  CounterpartPersonaV4LenientSchema,
  CounterpartPersonaV5VariablesSchema,
  type CounterpartPersonaV5Variables,
  PERSONA_FORWARDNESS,
  PERSONA_TRAIT_SOURCES,
  PERSONA_PATIENCE,
  PERSONA_WARMTH,
  PERSONA_DODGE_TOLERANCE,
  PERSONA_CEILING,
  PERSONA_LEAVING,
  PersonaConductSchema,
  type PersonaConduct,
  CounterpartPersonaV6LenientSchema,
  type CounterpartPersonaV6Lenient,
  type CounterpartPersonaStored,
  type CounterpartPersonaV4Lenient,
  type PersonaForwardness,
  type CounterpartPersonaLenient,
  PERSONA_MOODS,
  type CounterpartPersonaResult,
  type CounterpartPersonaVariables,
} from "./prompts/schemas/investor-persona.js";
// end REHEARSE block
export { FOUNDER_RESEARCH_READER_V1 } from "./prompts/tasks/founder-research-reader.v1.js";
export {
  FOUNDER_RESEARCH_READER_SCHEMA_NAME,
  FOUNDER_RESEARCH_READER_SCHEMA_VERSION,
  FOUNDER_RESEARCH_READER_UNTRUSTED,
  FounderResearchReaderResultSchema,
  FounderResearchReaderVariablesSchema,
  type FounderResearchReaderResult,
  type FounderResearchReaderVariables,
} from "./prompts/schemas/founder-research-reader.js";
export {
  INVESTOR_TWIN_TURN_SCHEMA_NAME,
  INVESTOR_TWIN_TURN_SCHEMA_VERSION,
  INVESTOR_TWIN_TURN_UNTRUSTED,
  InvestorTwinTurnResultSchema,
  InvestorTwinTurnVariablesSchema,
  REHEARSAL_RATINGS,
  REHEARSAL_SCORE_SCHEMA_NAME,
  REHEARSAL_SCORE_SCHEMA_VERSION,
  REHEARSAL_SCORE_UNTRUSTED,
  RehearsalScoreResultSchema,
  RehearsalScoreVariablesSchema,
  type InvestorTwinTurnResult,
  type InvestorTwinTurnVariables,
  type RehearsalScoreResult,
  type RehearsalScoreVariables,
} from "./prompts/schemas/rehearsal.js";
export {
  INVESTOR_PERSONA_SCHEMA_NAME,
  INVESTOR_PERSONA_SCHEMA_VERSION,
  INVESTOR_PERSONA_UNTRUSTED,
  InvestorPersonaResultSchema,
  InvestorPersonaVariablesSchema,
  type InvestorPersonaResult,
  type InvestorPersonaVariables,
} from "./prompts/schemas/investor-persona.js";
export {
  ERRAND_REPLY_SCHEMA_NAME,
  ERRAND_REPLY_SCHEMA_VERSION,
  ERRAND_REPLY_UNTRUSTED,
  ErrandReplyResultSchema,
  ErrandReplyVariablesSchema,
  type ErrandReplyResult,
  type ErrandReplyVariables,
} from "./prompts/schemas/errand-reply.js";
export {
  DILIGENCE_DOCUMENT_SUMMARY_SCHEMA_NAME,
  DILIGENCE_DOCUMENT_SUMMARY_SCHEMA_VERSION,
  DILIGENCE_DOCUMENT_SUMMARY_UNTRUSTED,
  DiligenceDocumentSummaryResultSchema,
  DiligenceDocumentSummaryVariablesSchema,
  type DiligenceDocumentSummaryResult,
  type DiligenceDocumentSummaryVariables,
} from "./prompts/schemas/diligence-document-summary.js";
export {
  MEETING_NOTES_SCHEMA_NAME,
  MEETING_NOTES_SCHEMA_VERSION,
  MeetingNotesResultSchema,
  MeetingNotesV2ResultSchema,
  MeetingNotesV3ResultSchema,
  MeetingNotesV3VariablesSchema,
  MeetingNextStepSchema,
  MEETING_NEXT_STEP_KINDS,
  MeetingNotesVariablesSchema,
  type MeetingNextStep,
  type MeetingNotesResult,
  type MeetingNotesV2Result,
  type MeetingNotesV3Result,
  type MeetingNotesV3Variables,
  type MeetingNotesVariables,
} from "./prompts/schemas/meeting-notes.js";
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
export { INVESTOR_RESEARCH_READER_V1 } from "./prompts/tasks/investor-research-reader.v1.js";
export {
  INVESTOR_RESEARCH_READER_SCHEMA_NAME,
  INVESTOR_RESEARCH_READER_SCHEMA_VERSION,
  INVESTOR_RESEARCH_READER_UNTRUSTED,
  InvestorResearchReaderResultSchema,
  InvestorResearchReaderVariablesSchema,
  type InvestorResearchReaderResult,
  type InvestorResearchReaderVariables,
} from "./prompts/schemas/investor-research-reader.js";
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
export { COMPANY_ANALYST_V9 } from "./prompts/tasks/company-analyst.v9.js";
export { COMPANY_ANALYST_V10 } from "./prompts/tasks/company-analyst.v10.js";
export { COMPANY_ANALYST_V11 } from "./prompts/tasks/company-analyst.v11.js";
export { COMPANY_ANALYST_V12 } from "./prompts/tasks/company-analyst.v12.js";
export {
  COMPANY_ANALYST_V13,
  COMPANY_ANALYST_V13_FORMAT_SECTION,
} from "./prompts/tasks/company-analyst.v13.js";
export { COMPANY_ANALYST_V14 } from "./prompts/tasks/company-analyst.v14.js";
export { COMPANY_ANALYST_V15 } from "./prompts/tasks/company-analyst.v15.js";
export {
  COMPANY_ANALYST_V16,
  COMPANY_ANALYST_V16_TURN,
} from "./prompts/tasks/company-analyst.v16.js";
export { ARTIFACT_REVISION_V1 } from "./prompts/tasks/artifact-revision.v1.js";
export { ARTIFACT_REVISION_V2 } from "./prompts/tasks/artifact-revision.v2.js";
export { ARTIFACT_REVISION_V3 } from "./prompts/tasks/artifact-revision.v3.js";
export {
  ARTIFACT_REVISION_BODY_MAX,
  ARTIFACT_REVISION_SLIDES_MAX,
  ARTIFACT_REVISION_V2_SCHEMA_VERSION,
  ARTIFACT_REVISION_V3_SCHEMA_VERSION,
  ArtifactRevisionV2ResultSchema,
  ArtifactRevisionV3ResultSchema,
  type ArtifactRevisionV3Result,
  type ArtifactRevisionV2Result,
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
export { INVESTOR_MANDATE_SYNTHESIS_V3 } from "./prompts/tasks/investor-mandate-synthesis.v3.js";
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
  CompanyAnalystV12ResultSchema,
  CompanyAnalystV14ResultSchema,
  CompanyAnalystV15ResultSchema,
  COMPANY_ANALYST_V15_SCHEMA_VERSION,
  PROPOSAL_STATUS_GUIDANCE,
  COMPANY_ANALYST_V14_SCHEMA_VERSION,
  ModelComparisonCardsSchema,
  type CompanyAnalystV12Result,
  type CompanyAnalystV14Result,
  type CompanyAnalystV15Result,
  type ModelComparisonCards,
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
  withoutPublicSourceLabels,
  publicSourceBlockFields,
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
// AUTO block: Q's delegated work prompts (ADR 0030).
export {
  WORK_CONVERSE_V1,
  WORK_INTERVIEW_REPORT_V1,
  WORK_INTERVIEW_TURN_V1,
  WORK_SHORTLIST_V1,
  WORK_STAND_IN_REPLY_V1,
  WORK_SLOT_READER_V1,
} from "./prompts/tasks/q-work.v1.js";
export {
  WorkConverseResultSchema,
  WorkInterviewReportResultSchema,
  WorkInterviewTurnResultSchema,
  WorkShortlistResultSchema,
  WorkStandInReplyResultSchema,
  WorkSlotReaderResultSchema,
  type WorkSlotReaderResult,
  type WorkSlotReaderVariables,
  type WorkConverseResult,
  type WorkConverseVariables,
  type WorkInterviewReportResult,
  type WorkInterviewReportVariables,
  type WorkInterviewTurnResult,
  type WorkInterviewTurnVariables,
  type WorkShortlistResult,
  type WorkShortlistVariables,
  type WorkStandInReplyResult,
  type WorkStandInReplyVariables,
} from "./prompts/schemas/q-work.js";
// end AUTO block
// ADR 0043: standing instructions.
export {
  INSTRUCTION_PLAN_V1,
  INSTRUCTION_PLAN_V2,
  INSTRUCTION_PLAN_V3,
  INSTRUCTION_PLAN_V4,
  INSTRUCTION_PLAN_V5,
  INSTRUCTION_THREAD_READER_V1,
  INSTRUCTION_THREAD_READER_V2,
} from "./prompts/tasks/instructions.v1.js";
export {
  InstructionThreadFactsSchema,
  InstructionThreadFactsV2Schema,
  INSTRUCTION_QUESTION_KINDS,
  type InstructionQuestionKind,
  type InstructionThreadFactsV2,
  type InstructionPlanV4Variables,
  type InstructionThreadFacts,
  type InstructionThreadReaderVariables,
  InstructionPlanResultSchema,
  InstructionPlanV2ResultSchema,
  InstructionPlanV3ResultSchema,
  InstructionPlanV5ResultSchema,
  INSTRUCTION_MESSAGE_KINDS,
  INSTRUCTION_MESSAGE_ASKS,
  type InstructionMessageKind,
  type InstructionMessageAsk,
  type InstructionPlanV5Result,
  INSTRUCTION_PLAN_REQUESTS,
  INSTRUCTION_CANNOT_NEEDS,
  ENGINE_ABILITIES,
  type InstructionPlanResult,
  type InstructionPlanV2Result,
  type InstructionPlanV3Result,
  type InstructionPlanVariables,
} from "./prompts/schemas/instructions.js";

// DOCS block: the wording pass over a composed deck.
export { DOCUMENT_POLISH_V1 } from "./prompts/tasks/document-polish.v1.js";
export {
  DOCUMENT_POLISH_SCHEMA_NAME,
  DOCUMENT_POLISH_SCHEMA_VERSION,
  DOCUMENT_POLISH_UNTRUSTED,
  DocumentPolishResultSchema,
  DocumentPolishVariablesSchema,
  type DocumentPolishResult,
  type DocumentPolishVariables,
} from "./prompts/schemas/document-polish.js";

// DAILY block (The Q Daily)
export { DAILY_STORY_WRITER_V1 } from "./prompts/tasks/daily-story-writer.v1.js";
export { DAILY_Q_TAKE_V1 } from "./prompts/tasks/daily-q-take.v1.js";
export {
  DAILY_Q_TAKE_SCHEMA_NAME,
  DAILY_Q_TAKE_SCHEMA_VERSION,
  DAILY_Q_TAKE_UNTRUSTED,
  DAILY_STORY_WRITER_SCHEMA_NAME,
  DAILY_STORY_WRITER_SCHEMA_VERSION,
  DAILY_STORY_WRITER_UNTRUSTED,
  DailyQTakeResultSchema,
  DailyQTakeVariablesSchema,
  DailyStoryWriterResultSchema,
  DailyStoryWriterVariablesSchema,
  type DailyQTakeResult,
  type DailyQTakeVariables,
  type DailyStoryWriterResult,
  type DailyStoryWriterVariables,
} from "./prompts/schemas/daily.js";
// end DAILY block
// PRESENCE block
export {
  gesturesForReply,
  ModelSentenceGesturesEnumSchema,
  ModelSentenceGesturesSchema,
  PRESENCE_GESTURES_GUIDANCE,
  sentenceCount,
  type ModelSentenceGestures,
} from "./speech/gesture.js";
// end PRESENCE block
export { PROFILE_GAP_READER_V1 } from "./prompts/tasks/profile-gap-reader.v1.js";
export {
  PROFILE_GAP_READER_SCHEMA_NAME,
  PROFILE_GAP_READER_SCHEMA_VERSION,
  ProfileGapReaderResultSchema,
  ProfileGapReaderVariablesSchema,
  type ProfileGapReaderResult,
  type ProfileGapReaderVariables,
} from "./prompts/schemas/profile-gap-reader.js";
export { APP_ACTION_ARGUMENTS_V1 } from "./prompts/tasks/app-action-arguments.v1.js";
export { APP_ACTION_ROUTER_V1 } from "./prompts/tasks/app-action-router.v1.js";
export {
  APP_ACTION_ROUTER_SCHEMA_NAME,
  APP_ACTION_ROUTER_SCHEMA_VERSION,
  AppActionRouterResultSchema,
  AppActionRouterVariablesSchema,
  type AppActionRouterResult,
  type AppActionRouterVariables,
} from "./prompts/schemas/app-action-router.js";
export {
  APP_ACTION_ARGUMENTS_SCHEMA_NAME,
  APP_ACTION_ARGUMENTS_SCHEMA_VERSION,
  AppActionArgumentsResultSchema,
  AppActionArgumentsVariablesSchema,
  type AppActionArgumentsResult,
  type AppActionArgumentsVariables,
} from "./prompts/schemas/app-action-arguments.js";
