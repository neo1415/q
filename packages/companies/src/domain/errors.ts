/**
 * Transport-neutral Company failures. The API's problem handler maps them;
 * nothing here knows an HTTP status. Messages never confirm that a company
 * exists for somebody else.
 */

/** Enumeration-safe: absent, foreign, or outside the caller's context. */
export class CompanyNotFoundError extends Error {
  constructor(message = "The requested company was not found.") {
    super(message);
    this.name = "CompanyNotFoundError";
  }
}

export class CompanyVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("The company has changed since it was read.");
    this.name = "CompanyVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

/** Same person, same organisation, same Idempotency-Key, different request. */
export class CompanyCreationConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used to create a company with a different request.",
    );
    this.name = "CompanyCreationConflictError";
  }
}

/** The bounded slug strategy is exhausted for this tenant. */
export class CompanySlugUnavailableError extends Error {
  constructor() {
    super("A unique company slug could not be allocated.");
    this.name = "CompanySlugUnavailableError";
  }
}
