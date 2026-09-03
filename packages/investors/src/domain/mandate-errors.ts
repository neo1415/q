/**
 * Declared-mandate failures. Transport-neutral; the API maps them.
 * Messages never confirm that a mandate exists for somebody else.
 */

/** Enumeration-safe: absent, foreign, or outside the caller's context. */
export class InvestorMandateNotFoundError extends Error {
  constructor(message = "The requested mandate was not found.") {
    super(message);
    this.name = "InvestorMandateNotFoundError";
  }
}

/**
 * The requested transition or edit is not allowed in the mandate's current
 * lifecycle state (a CLOSED mandate is history; only DRAFT activates).
 */
export class InvestorMandateLifecycleError extends Error {
  readonly status: string;

  constructor(status: string, message: string) {
    super(message);
    this.name = "InvestorMandateLifecycleError";
    this.status = status;
  }
}

/** Same person, same investor organisation, same Idempotency-Key, different request. */
export class InvestorMandateCreationConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used to create a mandate with a different request.",
    );
    this.name = "InvestorMandateCreationConflictError";
  }
}
