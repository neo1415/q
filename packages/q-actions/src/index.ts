/**
 * @capital-q/q-actions
 *
 * Owns: the Approval Engine and consequential action authority (doc 12
 * §29-§33; doc 13 §48; doc 15 §50-§53; doc 22 §79-§87; CQ-Q-008) — durable
 * Q action proposals and human approvals in `q_runtime.actions` and
 * `q_runtime.approvals`, the deterministic action and approval state
 * machines, the canonical approval-bound envelope and its SHA-256
 * fingerprint, approver authorization, execution-time reauthorization, the
 * idempotent execution gate, the typed executor registry, the audit and
 * domain-event integration, and the orchestration seam.
 *
 * Does not own: any real side effect. No email, calendar, messaging,
 * Data Room, connector or MCP executor exists here; the only executor is
 * test-only and lives under `./testing`. Models, tools, prompts, the
 * Context Firewall and the run lifecycle are other packages' — this one
 * consumes their ports and trusts none of their words.
 *
 *   Q proposal ≠ approval ≠ permission ≠ execution ≠ outcome
 *   clicked approve ≠ arbitrary future authority
 *   LangGraph interrupt ≠ approval authority
 *   voice / MCP / OAuth ≠ Capital Q authorization
 *
 * Server-side only.
 */

export {
  defineQAction,
  type AnyQActionDefinition,
  type ApprovedQAction,
  type QActionAuthorization,
  type QActionDefinition,
  type QActionExecutionContext,
  type QActionExecutionReport,
  type QActionExecutor,
} from "./definition.js";
export {
  createQActionRegistry,
  Q_ACTION_REGISTRABLE_CLASSES,
  type QActionRegistry,
} from "./registry.js";
export {
  DEFAULT_Q_APPROVAL_POLICY,
  systemQActionClock,
  type NewQAction,
  type NewQApproval,
  type QActionClock,
  type QActionRecord,
  type QActionRepositories,
  type QActionRepository,
  type QActionTransition,
  type QApprovalDecision,
  type QApprovalPolicy,
  type QApprovalRecord,
  type QApprovalRepository,
} from "./ports.js";
export {
  bindingEnvelope,
  hashBindingEnvelope,
  hashesMatch,
} from "./domain/binding.js";
export {
  approvalIsOpen,
  approvalIsUsable,
  assertActionTransition,
  assertApprovalTransition,
  canTransitionAction,
  canTransitionApproval,
  isTerminalApprovalStatus,
  Q_ACTION_TRANSITIONS,
  Q_APPROVAL_TRANSITIONS,
} from "./domain/lifecycle.js";
export {
  QActionAlreadyCompletedError,
  QActionNotFoundError,
  QActionNotPermittedError,
  QActionPayloadMismatchError,
  QActionTransitionError,
  QActionUnavailableError,
  QActionVersionConflictError,
  QApprovalAlreadyDecidedError,
  QApprovalExpiredError,
  QApprovalNotFoundError,
  QApprovalNotPermittedError,
  QApprovalTransitionError,
} from "./domain/errors.js";
export {
  createQActionService,
  envelopeOf,
  idempotencyKeyFor,
  projectedApprovalStatus,
  toApprovalView,
  type DecideQApprovalCommand,
  type DecideQApprovalResult,
  type ProposeQActionCommand,
  type ProposeQActionResult,
  type QActionService,
  type QActionServiceDependencies,
  type QApprovalQuery,
} from "./application/service.js";
export {
  createQActionPort,
  noQActionProposer,
  type QActionProposer,
} from "./application/port.js";
export { createPostgresQActionRepositories } from "./infrastructure/postgres-repositories.js";

export const PACKAGE_NAME = "@capital-q/q-actions" as const;
