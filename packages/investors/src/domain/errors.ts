/**
 * Transport-neutral Investor failures. The API's problem handler maps them;
 * nothing here knows an HTTP status. Messages never confirm that an
 * investor organisation exists for somebody else.
 */

/** Enumeration-safe: absent, foreign, or outside the caller's context. */
export class InvestorOrganisationNotFoundError extends Error {
  constructor(message = "The requested investor organisation was not found.") {
    super(message);
    this.name = "InvestorOrganisationNotFoundError";
  }
}

/** The active organisation already has its canonical investor organisation. */
export class InvestorOrganisationExistsError extends Error {
  constructor() {
    super("This organisation already has an investor organisation.");
    this.name = "InvestorOrganisationExistsError";
  }
}

/** Shared optimistic-concurrency failure for investor state. */
export class InvestorVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number, what = "investor organisation") {
    super(`The ${what} has changed since it was read.`);
    this.name = "InvestorVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

/** Same person, same organisation, same Idempotency-Key, different request. */
export class InvestorCreationConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used to create an investor organisation with a different request.",
    );
    this.name = "InvestorCreationConflictError";
  }
}

/** The caller has no current representation of this investor organisation. */
export class InvestorRepresentativeNotFoundError extends Error {
  constructor(
    message = "No current representation of this investor organisation was found for you.",
  ) {
    super(message);
    this.name = "InvestorRepresentativeNotFoundError";
  }
}

/** Enumeration-safe: absent, removed, or not visible in this context. */
export class InvestorPortfolioReferenceNotFoundError extends Error {
  constructor(message = "The portfolio reference was not found.") {
    super(message);
    this.name = "InvestorPortfolioReferenceNotFoundError";
  }
}
