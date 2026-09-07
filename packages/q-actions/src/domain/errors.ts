import type { QActionStatus, QApprovalStatus } from "@capital-q/contracts";

/**
 * Domain errors of the Approval Engine. Every message here is the plain
 * English a person may read (CQ-Q-008 §44, §98); the stable internal
 * `errorCode` on each class is what logs, traces and metrics use. No
 * message names a tenant, a table, a hash, a status word or another person.
 *
 * The field is deliberately not called `code`: the transaction manager
 * treats any thrown object carrying `code` as a driver failure and wraps
 * it, which would turn "not found" into a database error at the boundary.
 *
 * Existence is never confirmed to someone who may not act: a foreign
 * tenant, a different person and a missing row all receive
 * QApprovalNotFoundError.
 */

export class QActionTransitionError extends Error {
  readonly errorCode = "ACTION_INVALID_TRANSITION" as const;
  readonly from: QActionStatus;
  readonly to: QActionStatus;

  constructor(from: QActionStatus, to: QActionStatus) {
    super("This action can't be moved to that state.");
    this.name = "QActionTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class QApprovalTransitionError extends Error {
  readonly errorCode = "APPROVAL_INVALID_TRANSITION" as const;
  readonly from: QApprovalStatus;
  readonly to: QApprovalStatus;

  constructor(from: QApprovalStatus, to: QApprovalStatus) {
    super("This approval has already been decided.");
    this.name = "QApprovalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Not found, another tenant's, or not this person's to decide: one answer. */
export class QApprovalNotFoundError extends Error {
  readonly errorCode = "APPROVAL_NOT_FOUND" as const;

  constructor() {
    super("We couldn't find that approval.");
    this.name = "QApprovalNotFoundError";
  }
}

/** The right person, but the authority to approve is missing or revoked. */
export class QApprovalNotPermittedError extends Error {
  readonly errorCode = "APPROVAL_NOT_PERMITTED" as const;

  constructor() {
    super("You can't approve this action.");
    this.name = "QApprovalNotPermittedError";
  }
}

export class QApprovalExpiredError extends Error {
  readonly errorCode = "APPROVAL_EXPIRED" as const;

  constructor() {
    super("This approval has expired. Ask Q to prepare the action again.");
    this.name = "QApprovalExpiredError";
  }
}

/** Already approved, rejected or revoked: the decision stands. */
export class QApprovalAlreadyDecidedError extends Error {
  readonly errorCode = "APPROVAL_ALREADY_DECIDED" as const;
  readonly status: QApprovalStatus;

  constructor(status: QApprovalStatus) {
    super(
      status === "APPROVED"
        ? "This action has already been approved."
        : status === "REJECTED"
          ? "This action has already been declined."
          : "This approval is no longer open.",
    );
    this.name = "QApprovalAlreadyDecidedError";
    this.status = status;
  }
}

/** The persisted proposal no longer hashes to what was approved or proposed. */
export class QActionPayloadMismatchError extends Error {
  readonly errorCode = "ACTION_PAYLOAD_MISMATCH" as const;

  constructor() {
    super("This action changed and needs to be reviewed again.");
    this.name = "QActionPayloadMismatchError";
  }
}

export class QActionAlreadyCompletedError extends Error {
  readonly errorCode = "ACTION_ALREADY_COMPLETED" as const;

  constructor() {
    super("This action has already been completed.");
    this.name = "QActionAlreadyCompletedError";
  }
}

/** A registered definition refused the payload, the targets or the actor at proposal time. */
export class QActionNotPermittedError extends Error {
  readonly errorCode = "ACTION_NOT_PERMITTED" as const;

  constructor() {
    super("You don't have permission to perform this action.");
    this.name = "QActionNotPermittedError";
  }
}

/** The action type is unknown, prohibited or not registered for proposal. */
export class QActionUnavailableError extends Error {
  readonly errorCode = "ACTION_UNAVAILABLE" as const;

  constructor() {
    super("Q can't perform that kind of action.");
    this.name = "QActionUnavailableError";
  }
}

export class QActionNotFoundError extends Error {
  readonly errorCode = "ACTION_NOT_FOUND" as const;

  constructor() {
    super("We couldn't find that action.");
    this.name = "QActionNotFoundError";
  }
}

/** A stale writer: the row changed under a concurrent decision. Retry reads fresh state. */
export class QActionVersionConflictError extends Error {
  readonly errorCode = "ACTION_VERSION_CONFLICT" as const;

  constructor() {
    super("This action was updated by another request. Please refresh.");
    this.name = "QActionVersionConflictError";
  }
}
