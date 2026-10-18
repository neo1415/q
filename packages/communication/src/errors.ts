/**
 * Not a party, no such relationship, no such message: one answer, so the
 * chat cannot be used to ask which relationships or messages exist.
 */
export class ChatNotFoundError extends Error {
  constructor() {
    super("That conversation isn't available.");
    this.name = "ChatNotFoundError";
  }
}

/** A party, but messaging opens only after both sides connect (§6.6.6). */
export class ChatNotConnectedError extends Error {
  constructor() {
    super(
      "Messages open once you're connected: when interest has been expressed and accepted.",
    );
    this.name = "ChatNotConnectedError";
  }
}

/** The attachment is not the sender's own, or it has not cleared scanning. */
export class ChatAttachmentUnavailableError extends Error {
  readonly reason: "NOT_FOUND" | "NOT_READY";
  constructor(reason: "NOT_FOUND" | "NOT_READY") {
    super(
      reason === "NOT_READY"
        ? "That file is still being checked. Send it once it's ready."
        : "Only your own organisation's documents can be shared here.",
    );
    this.name = "ChatAttachmentUnavailableError";
    this.reason = reason;
  }
}

/** The same idempotency key was used for a different message. */
export class ChatIdempotencyConflictError extends Error {
  constructor() {
    super("That request key was already used for a different message.");
    this.name = "ChatIdempotencyConflictError";
  }
}

/**
 * A side has blocked messaging on this relationship. Said the same way to
 * both sides: the blocked side is never told who blocked.
 */
export class ChatBlockedError extends Error {
  constructor() {
    super("You can't message this relationship right now.");
    this.name = "ChatBlockedError";
  }
}

/** The report reason is not one of the reference reasons. */
export class ChatReportReasonError extends Error {
  constructor() {
    super("Choose a reason for the report.");
    this.name = "ChatReportReasonError";
  }
}
