/**
 * Transport-neutral organisation failures. No HTTP status here; the API's
 * problem handler decides how each is expressed.
 *
 * Messages are safe to show a caller and never confirm that a resource
 * exists for somebody else.
 */

/**
 * Enumeration-safe: raised identically whether the organisation does not
 * exist, belongs to another tenant, or is not the caller's current context.
 */
export class OrganisationNotFoundError extends Error {
  constructor(message = "The requested organisation was not found.") {
    super(message);
    this.name = "OrganisationNotFoundError";
  }
}

/** The caller's expected version is behind the stored profile. */
export class OrganisationVersionConflictError extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("The organisation has changed since it was read.");
    this.name = "OrganisationVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

/** Same person, same Idempotency-Key, different request. */
export class OrganisationCreationConflictError extends Error {
  constructor() {
    super(
      "This idempotency key was already used to create an organisation with a different request.",
    );
    this.name = "OrganisationCreationConflictError";
  }
}

/**
 * Required reference data (a role template, a capability) is missing from
 * the database. A server integrity failure: the domain never invents a role
 * to compensate.
 */
export class OrganisationReferenceDataError extends Error {
  constructor(what: string) {
    super(`Required reference data is missing: ${what}.`);
    this.name = "OrganisationReferenceDataError";
  }
}
