import {
  isTerminalQRunStatus,
  type QCapability,
  type QConsequenceClass,
  type QRunStatus,
} from "@capital-q/contracts";

import { QRunTransitionError } from "./errors.js";

/**
 * The deterministic Q run lifecycle (doc 12 §9.1, §47; doc 22 §78).
 *
 * One transition map, consulted by every status change. There is no route,
 * repository method or worker that sets a status directly: the policy
 * decides, the repository applies it under a version predicate, and an
 * invalid move is a domain error rather than a silent write. Terminal
 * states have no outgoing edges at all.
 *
 * Not every run visits every state. A quick answer may go RECEIVED →
 * PREFLIGHT → … → SYNTHESIS → COMPLETED; an approval flow pauses at
 * AWAITING_APPROVAL. What the map fixes is the set of moves that can ever
 * be made, so a later orchestrator cannot invent one.
 */

/** The status every accepted run starts in. Nothing has run yet. */
export const INITIAL_Q_RUN_STATUS = "RECEIVED" as const satisfies QRunStatus;

const FAIL: readonly QRunStatus[] = ["FAILED"];
const FAIL_OR_EXPIRE: readonly QRunStatus[] = ["FAILED", "EXPIRED"];

export const Q_RUN_TRANSITIONS: Readonly<
  Record<QRunStatus, readonly QRunStatus[]>
> = {
  // Accepted, not yet picked up. Nothing is in flight, so a cancel is
  // immediate.
  RECEIVED: ["PREFLIGHT", "CANCELLED", ...FAIL_OR_EXPIRE],
  PREFLIGHT: ["CONTEXT_RESOLUTION", "CANCEL_REQUESTED", ...FAIL_OR_EXPIRE],
  CONTEXT_RESOLUTION: ["POLICY_CHECK", "CANCEL_REQUESTED", ...FAIL],
  POLICY_CHECK: ["PLANNING", "CANCEL_REQUESTED", ...FAIL],
  PLANNING: [
    "RETRIEVAL",
    "SPECIALIST_EXECUTION",
    "SYNTHESIS",
    "AWAITING_INPUT",
    "CANCEL_REQUESTED",
    ...FAIL,
  ],
  RETRIEVAL: ["SPECIALIST_EXECUTION", "SYNTHESIS", "CANCEL_REQUESTED", ...FAIL],
  SPECIALIST_EXECUTION: [
    "SYNTHESIS",
    "AWAITING_INPUT",
    "CANCEL_REQUESTED",
    ...FAIL,
  ],
  SYNTHESIS: [
    "VERIFICATION",
    "AWAITING_INPUT",
    "AWAITING_APPROVAL",
    "COMPLETED",
    "CANCEL_REQUESTED",
    ...FAIL,
  ],
  VERIFICATION: [
    "SYNTHESIS",
    "AWAITING_INPUT",
    "AWAITING_APPROVAL",
    "COMPLETED",
    "CANCEL_REQUESTED",
    ...FAIL,
  ],
  // Paused for a person. Nothing is in flight, so a cancel is immediate;
  // the pause can also time out.
  AWAITING_INPUT: ["PLANNING", "CANCELLED", ...FAIL_OR_EXPIRE],
  AWAITING_APPROVAL: [
    "ACTION_EXECUTION",
    "COMPLETED",
    "CANCELLED",
    ...FAIL_OR_EXPIRE,
  ],
  ACTION_EXECUTION: ["COMPLETED", "CANCEL_REQUESTED", ...FAIL],
  // Work was asked to stop. It stops, finishes what was already committed,
  // or fails — but it never resumes.
  CANCEL_REQUESTED: ["CANCELLED", "COMPLETED", ...FAIL],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: QRunStatus, to: QRunStatus): boolean {
  return Q_RUN_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: QRunStatus, to: QRunStatus): void {
  if (!canTransition(from, to)) {
    throw new QRunTransitionError(from, to);
  }
}

/** Every state a run can move to from `from`. */
export function allowedTransitionsFrom(
  from: QRunStatus,
): readonly QRunStatus[] {
  return Q_RUN_TRANSITIONS[from];
}

/**
 * What a cancellation request means for a run in `status`.
 *
 *   CANCEL_NOW         nothing is in flight; the run becomes CANCELLED at once
 *   REQUEST_CANCEL     work is in flight; the run becomes CANCEL_REQUESTED and
 *                      the orchestrator stops cooperatively (CQ-Q-003)
 *   ALREADY_CANCELLING already cancelled or being cancelled; idempotent no-op
 *   ALREADY_TERMINAL   completed, failed or expired; there is nothing to cancel
 */
export type QCancellationDecision =
  | { readonly kind: "CANCEL_NOW" }
  | { readonly kind: "REQUEST_CANCEL" }
  | { readonly kind: "ALREADY_CANCELLING" }
  | { readonly kind: "ALREADY_TERMINAL" };

export function decideCancellation(status: QRunStatus): QCancellationDecision {
  if (status === "CANCELLED" || status === "CANCEL_REQUESTED") {
    return { kind: "ALREADY_CANCELLING" };
  }
  if (isTerminalQRunStatus(status)) {
    return { kind: "ALREADY_TERMINAL" };
  }
  if (canTransition(status, "CANCELLED")) {
    return { kind: "CANCEL_NOW" };
  }
  return { kind: "REQUEST_CANCEL" };
}

/**
 * Whether a person may add a turn to a run in `status`. A terminal run is
 * finished; a run being cancelled is ending. A person who wants to carry
 * on starts a new run in the same conversation.
 */
export function acceptsMessages(status: QRunStatus): boolean {
  return !isTerminalQRunStatus(status) && status !== "CANCEL_REQUESTED";
}

/**
 * The V1 consequence class of a request, from its capability. Decided by
 * the server, never declared by a client (doc 12 §8). Preparing an action
 * is high-consequence by construction; a comparison or assessment shapes a
 * decision; an answer or classification does not commit anyone to anything.
 * The Context Firewall and policy packets may refine this from subject and
 * scope; they cannot lower what a client sent, because a client sends none.
 */
const CONSEQUENCE_BY_CAPABILITY: Readonly<
  Record<QCapability, QConsequenceClass>
> = {
  ANSWER: "LOW",
  CLASSIFY: "LOW",
  INVESTIGATE: "MODERATE",
  COMPARE: "MODERATE",
  ASSESS: "MODERATE",
  PREPARE_ACTION: "HIGH",
};

export function consequenceClassFor(
  capability: QCapability,
): QConsequenceClass {
  return CONSEQUENCE_BY_CAPABILITY[capability];
}
