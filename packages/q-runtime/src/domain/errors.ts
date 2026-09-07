import type { QRunStatus, QSubjectKind } from "@capital-q/contracts";

/**
 * Q runtime domain errors.
 *
 * "Not found" is the answer for everything the caller is not entitled to
 * see: a run or conversation owned by another person or another tenant is
 * indistinguishable from one that never existed (enumeration safety). The
 * messages here are the plain-English detail a client may show; the class
 * is what the HTTP adapter branches on. No message names a tenant, a person,
 * a table or a status vocabulary word.
 */

export class QRunNotFoundError extends Error {
  constructor() {
    super("I couldn't find that Q request.");
    this.name = "QRunNotFoundError";
  }
}

export class QConversationNotFoundError extends Error {
  constructor() {
    super("I couldn't find that Q conversation.");
    this.name = "QConversationNotFoundError";
  }
}

/** A conversation that has been archived no longer accepts new runs. */
export class QConversationArchivedError extends Error {
  constructor() {
    super("That Q conversation has been archived.");
    this.name = "QConversationArchivedError";
  }
}

/**
 * A named subject could not be resolved in the caller's context. Absent,
 * foreign-tenant and inaccessible subjects all arrive here, on purpose.
 */
export class QSubjectNotFoundError extends Error {
  constructor() {
    super("I couldn't find one of the subjects in that request.");
    this.name = "QSubjectNotFoundError";
  }
}

/** A subject kind the runtime has no resolver for. Fails closed. */
export class QSubjectUnsupportedError extends Error {
  readonly kind: QSubjectKind;

  constructor(kind: QSubjectKind) {
    super("That kind of subject isn't supported yet.");
    this.name = "QSubjectUnsupportedError";
    this.kind = kind;
  }
}

/** Same idempotency key, different request. */
export class QRunCreationConflictError extends Error {
  constructor() {
    super("This request was already used to start a different Q request.");
    this.name = "QRunCreationConflictError";
  }
}

export class QMessageCreationConflictError extends Error {
  constructor() {
    super("This request was already used to send a different message.");
    this.name = "QMessageCreationConflictError";
  }
}

/**
 * The lifecycle refused the move. Carries both ends for the operator; the
 * public detail names neither vocabulary word.
 */
export class QRunTransitionError extends Error {
  readonly from: QRunStatus;
  readonly to: QRunStatus;

  constructor(from: QRunStatus, to: QRunStatus) {
    super("This Q request can't move to that state from where it is.");
    this.name = "QRunTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Completed, failed or expired: there is nothing left to cancel or add to. */
export class QRunAlreadyTerminalError extends Error {
  readonly status: QRunStatus;

  constructor(status: QRunStatus) {
    super("This request has already finished.");
    this.name = "QRunAlreadyTerminalError";
    this.status = status;
  }
}

/** The run is finished or finishing; a new run continues the conversation. */
export class QRunNotAcceptingMessagesError extends Error {
  readonly status: QRunStatus;

  constructor(status: QRunStatus) {
    super(
      "This request isn't taking new messages. Start a new request to continue the conversation.",
    );
    this.name = "QRunNotAcceptingMessagesError";
    this.status = status;
  }
}

/** Someone else changed the run first. The stale writer loses. */
export class QRunVersionConflictError extends Error {
  constructor() {
    super("The Q request changed since it was read. Please try again.");
    this.name = "QRunVersionConflictError";
  }
}
