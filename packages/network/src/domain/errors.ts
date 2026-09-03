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
