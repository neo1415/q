/**
 * Transport-neutral Capital Objective failures. The API's problem handler
 * maps them; nothing here knows an HTTP status. Messages never confirm that
 * a company or objective exists for somebody else.
 */

/** Enumeration-safe: absent, foreign, or outside the caller's context. */
export class CapitalObjectiveNotFoundError extends Error {
  constructor(message = "The requested capital objective was not found.") {
    super(message);
    this.name = "CapitalObjectiveNotFoundError";
  }
}

/** The company already has an ACTIVE objective; use the explicit replace workflow. */
export class ActiveCapitalObjectiveExistsError extends Error {
  constructor() {
    super(
      "This company already has an active capital objective. Replace it explicitly to start a new one.",
    );
    this.name = "ActiveCapitalObjectiveExistsError";
  }
}

/** The operation is not allowed in the objective's (or company's) current lifecycle state. */
export class CapitalObjectiveLifecycleError extends Error {
  readonly status: string;

  constructor(status: string, message: string) {
    super(message);
    this.name = "CapitalObjectiveLifecycleError";
    this.status = status;
  }
}

export class CapitalObjectiveVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("The capital objective has changed since it was read.");
    this.name = "CapitalObjectiveVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

/** Same person, same company, same Idempotency-Key, different request. */
export class CapitalObjectiveCreationConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used to create a capital objective with a different request.",
    );
    this.name = "CapitalObjectiveCreationConflictError";
  }
}
