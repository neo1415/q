import type { MessageRejection } from "@capital-q/contracts";

/**
 * The event offered to the outbox is not a valid, registered CapitalQEvent.
 *
 * Thrown inside the caller's transaction so the enclosing business operation
 * fails: a material change whose required event cannot be recorded is
 * incomplete. Carries the rejection class and event identity, never the
 * payload.
 */
export class OutboxEventInvalidError extends Error {
  readonly rejection: MessageRejection | "TENANT_REQUIRED";
  readonly eventType: string | undefined;
  readonly eventVersion: number | undefined;

  constructor(
    rejection: MessageRejection | "TENANT_REQUIRED",
    eventType: string | undefined,
    eventVersion: number | undefined,
  ) {
    super(
      `Event ${eventType ?? "<unknown>"}@${String(eventVersion ?? "?")} cannot be enqueued (${rejection}).`,
    );
    this.name = "OutboxEventInvalidError";
    this.rejection = rejection;
    this.eventType = eventType;
    this.eventVersion = eventVersion;
  }
}

/**
 * An outbox row already exists for this EventId with different content.
 *
 * Retrying an idempotent command may legitimately offer the same event twice;
 * that is accepted silently. Offering a *different* event under an existing
 * id is a defect and is never resolved by overwriting.
 */
export class OutboxEventConflictError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(
      `An outbox record already exists for event ${eventId} with different content.`,
    );
    this.name = "OutboxEventConflictError";
    this.eventId = eventId;
  }
}
