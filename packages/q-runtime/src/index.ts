/**
 * @capital-q/q-runtime
 *
 * Owns: the durable spine of a Q interaction — conversations, conversation
 * messages, runs, append-only run events (schema `q_runtime`) — plus the
 * deterministic run lifecycle policy, cancellation semantics, ownership
 * checks, idempotent creation and the application services the Q API
 * composes.
 *
 * Does not own: orchestration (CQ-Q-003), the Context Firewall (CQ-Q-004),
 * models (CQ-Q-005), prompts (CQ-Q-006), tools (CQ-Q-007), approvals
 * (CQ-Q-008), the stream transport (CQ-Q-009), retrieval, or Q knowledge.
 * Nothing here reasons, and nothing here can reach a model.
 *
 *   Q conversation ≠ Q institutional memory
 *   Q message      ≠ canonical company truth
 *   Q run          ≠ Q Knowledge Object
 *   Q run event    ≠ domain event ≠ audit event
 *   run accepted   ≠ analysis completed
 *
 * Server-side only.
 */

export {
  Q_CONVERSATION_CONTEXT_TYPES,
  QConversationContextTypeSchema,
  toQMessage,
  toQRunHandle,
  toQRunSummary,
  toQStreamEvent,
  type NewQConversation,
  type NewQConversationMessage,
  type NewQRun,
  type NewQRunEvent,
  type QConversation,
  type QConversationContextType,
  type QConversationMessage,
  type QRunEventRecord,
  type QRunRecord,
} from "./contracts/index.js";

export {
  QConversationArchivedError,
  QConversationNotFoundError,
  QMessageCreationConflictError,
  QRunAlreadyTerminalError,
  QRunCreationConflictError,
  QRunNotAcceptingMessagesError,
  QRunNotFoundError,
  QRunTransitionError,
  QRunVersionConflictError,
  QSubjectNotFoundError,
  QSubjectUnsupportedError,
} from "./domain/errors.js";
export {
  acceptsMessages,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  consequenceClassFor,
  decideCancellation,
  INITIAL_Q_RUN_STATUS,
  Q_RUN_TRANSITIONS,
  type QCancellationDecision,
} from "./domain/lifecycle.js";
export {
  hashAppendQRunMessageRequest,
  hashCreateQRunRequest,
  hashMessageIdempotencyKey,
  hashRunIdempotencyKey,
} from "./domain/idempotency.js";
export {
  createCapitalObjectiveQSubjectResolver,
  createCompanyQSubjectResolver,
  createDocumentQSubjectResolver,
  createInvestorOrganisationQSubjectResolver,
  createOrganisationQSubjectResolver,
  createQSubjectResolverRegistry,
  createRelationshipQSubjectResolver,
  createSelfUserQSubjectResolver,
  type QSubjectResolver,
  type QSubjectResolverRegistry,
  type QSubjectViewPort,
  type ResolvedQSubject,
} from "./domain/subjects.js";

export type { QRuntimeDependencies } from "./application/dependencies.js";
export type {
  QConversationMessageRepository,
  QConversationRepository,
  QMessageCreationRequestStore,
  QRunCreationRequestStore,
  QRunEventRepository,
  QRunRepository,
  QRunTransition,
  QRuntimeRepositories,
} from "./application/ports.js";
export {
  appendRunEvent,
  type QRunEventInput,
} from "./application/run-events.js";
export type {
  CreateQRunCommand,
  CreateQRunResult,
} from "./application/create-run.js";
export type { GetQRunQuery, GetQRunResult } from "./application/get-run.js";
export type {
  AppendQRunMessageCommand,
  AppendQRunMessageResult,
} from "./application/append-message.js";
export type {
  CancelQRunCommand,
  CancelQRunResult,
} from "./application/cancel-run.js";
export {
  createQRuntimeService,
  type QRuntimeService,
  type QRuntimeServiceOptions,
} from "./application/service.js";

export {
  createUnconfiguredQActions,
  createUnconfiguredQAnswer,
  createUnconfiguredQRetrieval,
  createUnconfiguredQTools,
  neverPause,
  type ContextFirewallDecision,
  type ContextFirewallPort,
  type ContextFirewallRequest,
  type QAnswerOutcome,
  type QAnswerPort,
  type QAnswerRequest,
  type QCancelInput,
  type QOrchestrationInput,
  type QOrchestrationSubjectContext,
  type QOrchestrator,
  type QPausePolicy,
  type QResumeInput,
  type QRetrievalOutcome,
  type QRetrievalPort,
  type QRetrievalRequest,
  type QActionExecuteContext,
  type QActionExecuteOutcome,
  type QActionPort,
  type QActionPrepareContext,
  type QActionPrepareOutcome,
  type QOfferedTool,
  type QToolCallOutcome,
  type QToolCallStatusOutcome,
  type QToolExecutionContext,
  type QToolPort,
  type QToolProposal,
  type QToolResult,
} from "./application/orchestration.js";
export {
  createQOrchestrationRuntime,
  runRef,
  type QLifecycleOutcome,
  type QOrchestrationRuntime,
  type QRunRef,
} from "./application/orchestration-runtime.js";
export {
  QOrchestrationVersionError,
  QRunAlreadyStartedError,
  QRunNotResumableError,
} from "./domain/orchestration-errors.js";

export { createPostgresQRuntimeRepositories } from "./infrastructure/postgres-q-runtime-repositories.js";
export { createPostgresQRunEventNotifier } from "./infrastructure/postgres-run-event-notifier.js";
export {
  createInProcessQLiveDeltaBus,
  createInProcessQRunEventNotifier,
  createQRunStreamService,
  projectPublicStreamEvent,
  Q_RUN_EVENTS_CHANNEL,
  QRunEventNoticeSchema,
  type QLiveDelta,
  type QLiveDeltaBus,
  type QLiveDeltaListener,
  type QRunEventListener,
  type QRunEventNotice,
  type QRunEventNotifier,
  type QRunEventPublisher,
  type QRunStreamDependencies,
  type QRunStreamItem,
  type QRunStreamOpenInput,
  type QRunStreamOptions,
  type QRunStreamService,
  type QRunStreamStats,
} from "./application/stream.js";

export const PACKAGE_NAME = "@capital-q/q-runtime" as const;
