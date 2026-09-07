import {
  isTerminalQActionStatus,
  type QActionStatus,
  type QApprovalStatus,
} from "@capital-q/contracts";

import { QActionTransitionError, QApprovalTransitionError } from "./errors.js";

/**
 * The deterministic action and approval state machines (doc 12 §31; CQ-Q-008
 * §20-§22). Two pure maps consulted by every status change; no service,
 * route, worker, model or graph sets a status directly. Terminal states
 * have no outgoing edges: a rejected action is never approved, an executed
 * action is never executed again, an expired approval is never revived. A
 * changed mind or a changed payload is a NEW action with a NEW approval.
 */

export const Q_ACTION_TRANSITIONS: Readonly<
  Record<QActionStatus, readonly QActionStatus[]>
> = {
  // Created inside the proposal transaction; leaves this state in the same
  // transaction when an approval is requested.
  PROPOSED: ["AWAITING_APPROVAL", "WITHDRAWN", "EXPIRED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "WITHDRAWN"],
  // Approved but nothing has happened. Can still lapse or be withdrawn.
  APPROVED: ["EXECUTING", "EXPIRED", "WITHDRAWN"],
  // Claimed by exactly one worker. Ends in a definite or an unknown outcome.
  EXECUTING: ["EXECUTED", "FAILED", "RECONCILIATION_REQUIRED"],
  // A definite failure may be retried under the same valid approval when
  // the failure was retryable (checked by policy, not by this map alone),
  // or ended when it was not.
  FAILED: ["EXECUTING", "EXPIRED", "WITHDRAWN"],
  EXECUTED: [],
  RECONCILIATION_REQUIRED: [],
  REJECTED: [],
  EXPIRED: [],
  WITHDRAWN: [],
};

export const Q_APPROVAL_TRANSITIONS: Readonly<
  Record<QApprovalStatus, readonly QApprovalStatus[]>
> = {
  PENDING: ["APPROVED", "REJECTED", "EXPIRED", "REVOKED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  REVOKED: [],
};

export function canTransitionAction(
  from: QActionStatus,
  to: QActionStatus,
): boolean {
  return Q_ACTION_TRANSITIONS[from].includes(to);
}

export function assertActionTransition(
  from: QActionStatus,
  to: QActionStatus,
): void {
  if (!canTransitionAction(from, to)) {
    throw new QActionTransitionError(from, to);
  }
}

export function canTransitionApproval(
  from: QApprovalStatus,
  to: QApprovalStatus,
): boolean {
  return Q_APPROVAL_TRANSITIONS[from].includes(to);
}

export function assertApprovalTransition(
  from: QApprovalStatus,
  to: QApprovalStatus,
): void {
  if (!canTransitionApproval(from, to)) {
    throw new QApprovalTransitionError(from, to);
  }
}

export function isTerminalApprovalStatus(status: QApprovalStatus): boolean {
  return Q_APPROVAL_TRANSITIONS[status].length === 0;
}

export { isTerminalQActionStatus };

/**
 * Whether an approval that is PENDING by record is still open at `now`.
 * Correctness never waits for a sweeper to flip the row: a request past
 * its expiry is expired wherever it is read (CQ-Q-008 §38, §106).
 */
export function approvalIsOpen(
  approval: { readonly status: QApprovalStatus; readonly expiresAt: string },
  now: Date,
): boolean {
  return (
    approval.status === "PENDING" &&
    now.getTime() < new Date(approval.expiresAt).getTime()
  );
}

/** An APPROVED decision is usable only until the request's own expiry. */
export function approvalIsUsable(
  approval: { readonly status: QApprovalStatus; readonly expiresAt: string },
  now: Date,
): boolean {
  return (
    approval.status === "APPROVED" &&
    now.getTime() < new Date(approval.expiresAt).getTime()
  );
}
