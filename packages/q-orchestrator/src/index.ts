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

export const PACKAGE_NAME = "@capital-q/q-orchestrator" as const;
