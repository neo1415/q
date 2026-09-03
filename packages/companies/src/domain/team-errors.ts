/**
 * Founder / team failures. Transport-neutral; the API maps them.
 */

/** The caller has no current relationship to this company. */
export class CompanyMemberNotFoundError extends Error {
  constructor(message = "No current company relationship was found for you.") {
    super(message);
    this.name = "CompanyMemberNotFoundError";
  }
}

export class FounderProfileNotFoundError extends Error {
  constructor(message = "No founder profile was found for you.") {
    super(message);
    this.name = "FounderProfileNotFoundError";
  }
}

export class CompanyTeamFactsNotFoundError extends Error {
  constructor(message = "No team facts have been recorded for this company.") {
    super(message);
    this.name = "CompanyTeamFactsNotFoundError";
  }
}

/**
 * The caller is not currently represented as a founder of this company, so
 * there is no founder profile to read or write in this context. Deliberately
 * the same whether the relationship is absent or non-founder.
 */
export class FounderProfileNotAllowedError extends Error {
  constructor(
    message = "A founder profile is available only to a current founder of this company.",
  ) {
    super(message);
    this.name = "FounderProfileNotAllowedError";
  }
}

/** Shared optimistic-concurrency failure for team state. */
export class TeamVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number, what: string) {
    super(`The ${what} has changed since it was read.`);
    this.name = "TeamVersionConflictError";
    this.currentVersion = currentVersion;
  }
}
