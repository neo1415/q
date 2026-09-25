/**
 * Transport-neutral Network failures. Messages never reveal which party or
 * which relationship exists to a caller who is not entitled to know.
 */

/** A relationship party (company or investor organisation) could not be resolved canonically. */
export class RelationshipPartyNotFoundError extends Error {
  readonly party: "company" | "investor_organisation";

  constructor(party: "company" | "investor_organisation") {
    super("A party of the requested relationship could not be resolved.");
    this.name = "RelationshipPartyNotFoundError";
    this.party = party;
  }
}

export class RelationshipNotFoundError extends Error {
  constructor(message = "The requested relationship was not found.") {
    super(message);
    this.name = "RelationshipNotFoundError";
  }
}

/** The event type is not registered in the Network event registry. */
export class RelationshipEventTypeUnknownError extends Error {
  readonly eventType: string;

  constructor(eventType: string) {
    super("The relationship event type is not registered.");
    this.name = "RelationshipEventTypeUnknownError";
    this.eventType = eventType;
  }
}

/**
 * The actor cannot express interest: they are not acting for an investor
 * organisation, or their role does not carry the capability. Safe to say:
 * it describes the caller, never a company.
 */
export class InterestNotPermittedError extends Error {
  constructor() {
    super("Only a member of an investor organisation can express interest.");
    this.name = "InterestNotPermittedError";
  }
}

/**
 * The company does not exist or is not visible to this investor. One error
 * for both, so the command cannot be used to ask which.
 */
export class InterestCompanyNotFoundError extends Error {
  constructor() {
    super("The company was not found.");
    this.name = "InterestCompanyNotFoundError";
  }
}

/** The idempotency key was already used for a different Express Interest request. */
export class InterestIdempotencyConflictError extends Error {
  constructor() {
    super("This idempotency key was already used with a different request.");
    this.name = "InterestIdempotencyConflictError";
  }
}

/** The chosen visibility scope is not allowed for this event type. */
export class RelationshipEventVisibilityNotAllowedError extends Error {
  readonly eventType: string;
  readonly visibilityScope: string;

  constructor(eventType: string, visibilityScope: string) {
    super("The visibility scope is not allowed for this relationship event.");
    this.name = "RelationshipEventVisibilityNotAllowedError";
    this.eventType = eventType;
    this.visibilityScope = visibilityScope;
  }
}
