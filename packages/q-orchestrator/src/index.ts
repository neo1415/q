/**
 * @capital-q/q-orchestrator
 *
 * Owns: the LangGraph-backed implementation of the Capital Q-owned
 * `QOrchestrator` port (declared in `@capital-q/q-runtime`), the initial
 * investigation graph, its bounded working state, the run → thread
 * mapping, the orchestration version policy, and the durable checkpoint
 * store under `q_runtime`.
 *
 * Does not own: the port itself, the run lifecycle (q-runtime), the Context
 * Firewall (CQ-Q-004), models (CQ-Q-005), prompts (CQ-Q-006), tools
 * (CQ-Q-007), approvals (CQ-Q-008), streaming (CQ-Q-009), retrieval,
 * specialists, or Q knowledge. Nothing here reasons, and nothing here can
 * reach a model.
 *
 *   Q ≠ LangGraph          graph checkpoint ≠ Q institutional memory
 *   Q run ≠ thread          graph state ≠ Company ≠ Evidence ≠ audit
 *
 * This is the only package that imports LangGraph. Its exports are
 * factories and Capital Q types; no graph, command, interrupt, checkpoint
 * or node type is exported.
 */

export {
  createInMemoryQCheckpointStore,
  createPostgresQCheckpointStore,
  Q_CHECKPOINT_SCHEMA,
  type QCheckpointStore,
} from "./checkpoint-store.js";
export {
  createLangGraphQOrchestrator,
  type LangGraphQOrchestratorOptions,
} from "./orchestrator.js";
export {
  Q_ANSWER_OUTCOMES,
  Q_GRAPH_STATE_FIELDS,
  Q_RETRIEVAL_OUTCOMES,
  QGraphStateSchema,
  type QGraphState,
} from "./state.js";
export {
  Q_CHECKPOINT_NAMESPACE,
  threadIdForRun,
  type QThreadId,
} from "./thread.js";
export {
  assertResumableOrchestrationVersion,
  isResumableOrchestrationVersion,
  Q_ORCHESTRATION_VERSION,
  Q_RESUMABLE_ORCHESTRATION_VERSIONS,
} from "./version.js";

// AUTO block: Q's delegated work (ADR 0030).
export {
  createQWorkEngine,
  delegationThreadId,
  laneThreadId,
  Q_WORK_GRAPH_VERSION,
  type AdvanceOutcome,
  type LaneStart,
  type QWorkEngine,
} from "./work/engine.js";
export { groundedPicks, MAX_CANDIDATES } from "./work/outreach.js";
export { MAX_STAND_IN_REPLIES } from "./work/stand-in.js";
export {
  CallWindowSchema,
  LANE_STAGES,
  OutreachGrantSchema,
  PersonAnswerSchema,
  Q2Q_DAILY_CAP,
  WAIT_NUDGE_AFTER_DAYS,
  WAIT_TELL_OWNER_AFTER_DAYS,
  Q2Q_INTENTS,
  QEnvelopeSchema,
  StandInGrantSchema,
  workPath,
  type CallWindow,
  type Candidate,
  type ConverseInput,
  type ConverseResult,
  type DelegationRef,
  type InterviewAnswer,
  type InterviewTurnInput,
  type InterviewTurnResult,
  type LaneObservation,
  type LanePatch,
  type LaneStage,
  type Notice,
  type ObservedMessage,
  type OutreachGrant,
  type PersonAnswer,
  type Q2QIntent,
  type QEnvelope,
  type QWorkPorts,
  type ShortlistPick,
  type Slot,
  type StandInGrant,
  type StandInObservation,
  type StandInReplyInput,
  type StandInReplyResult,
  type StandInThread,
} from "./work/types.js";
// end AUTO block

// WORKFORCE block (founder brief J1-J9): Q's workforce of agents.
export * from "./workforce/index.js";
// end WORKFORCE block

export const PACKAGE_NAME = "@capital-q/q-orchestrator" as const;
