import { z } from "zod";

import {
  CausationIdSchema,
  CorrelationIdSchema,
  createUuidIdSchema,
  UuidSchema,
} from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { VersionSchema } from "../common/version.js";

/**
 * Identifies one event occurrence. Used for deduplication, because delivery is
 * at-least-once and the same event will arrive more than once.
 *
 * Distinct from the aggregate id (what changed), the correlation id (which
 * workflow) and the request id (which HTTP call).
 */
export const EventIdSchema = createUuidIdSchema("EventId");
export type EventId = z.infer<typeof EventIdSchema>;

/**
 * Event names read `<context>.<entity-or-capability>.<past-tense-event>`:
 *
 *   core.company.updated
 *   evidence.document.ready
 *   network.relationship.interest_expressed
 *
 * The schema enforces the structure -- three dotted lower_snake_case segments.
 * It cannot enforce the tense: no regex distinguishes "processed" from
 * "process". An event names something that has already happened; a name like
 * `network.relationship.create_match` is a command and belongs to a job. That
 * rule is enforced by review, not by this schema.
 */
const MESSAGE_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2}$/;

export const EventTypeSchema = z
  .string()
  .regex(
    MESSAGE_NAME,
    "expected <context>.<entity>.<past_tense_event> in lower_snake_case",
  )
  .max(128);

export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * The logical producer, as a stable Capital Q URI:
 *
 *   capitalq://api/core/company
 *   capitalq://q-api/actions
 *   capitalq://workers/evidence
 *
 * Deliberately logical, never a deployment hostname. A message that identifies
 * its producer by host makes topology part of the contract, and every
 * re-platforming then becomes a contract change.
 */
export const EventSourceSchema = z
  .string()
  .regex(
    /^capitalq:\/\/[a-z0-9-]+(?:\/[a-z0-9_-]+)*$/,
    "expected a capitalq:// logical source",
  )
  .max(200);

/**
 * Who or what the event is attributed to.
 *
 * Attribution metadata only. `actor.type = "Q"` records that Q produced the
 * event; it does not establish that Q was authorised to act. Consequential Q
 * actions reference their own approval or delegation record, and audit remains
 * a separate system answering who acted under whose authority.
 */
export const EVENT_ACTOR_TYPES = [
  "HUMAN",
  "Q",
  "SYSTEM",
  "CONNECTED_SYSTEM",
] as const;

export const EventActorSchema = z.object({
  type: z.enum(EVENT_ACTOR_TYPES),
  /**
   * Optional: SYSTEM and Q events are attributable without a person. A supplied
   * id is identity, never authority.
   */
  id: z.string().min(1).max(200).optional(),
});

export type EventActor = z.infer<typeof EventActorSchema>;

/**
 * The aggregate this event belongs to, when one exists.
 *
 * `version` gives per-aggregate ordering. There is deliberately no global
 * sequence on the envelope: Capital Q does not assume a total order across the
 * system, and offering one field would invite consumers to depend on it.
 */
export const EventAggregateSchema = z.object({
  type: z.string().min(1).max(128),
  id: z.string().min(1).max(200),
  version: VersionSchema.optional(),
});

export type EventAggregate = z.infer<typeof EventAggregateSchema>;

/** The envelope specification version -- not the semantic version of any event. */
export const EVENT_SPEC_VERSION = "1.0" as const;

const eventEnvelopeShape = {
  specVersion: z.literal(EVENT_SPEC_VERSION),

  id: EventIdSchema,
  type: EventTypeSchema,
  source: EventSourceSchema,

  time: UtcTimestampSchema,

  /**
   * Optional routing and debugging hint, such as `company/<id>`. Not
   * authorization, and never human-readable private content -- subjects surface
   * in queue tooling and logs.
   */
  subject: z.string().min(1).max(200).optional(),

  dataContentType: z.literal("application/json"),

  /** Semantic version of this event type's payload. Starts at 1. */
  eventVersion: VersionSchema,

  /**
   * Optional on the generic envelope because not every platform event is
   * tenant-owned. This is not permission for tenant-owned events to omit it:
   * a tenant-owned event definition requires tenant context when created.
   * Never invent a placeholder tenant for a platform event.
   */
  tenantId: UuidSchema.optional(),

  /** Business context. Not proof of membership, authority or permission. */
  organisationId: UuidSchema.optional(),

  actor: EventActorSchema.optional(),

  /** Ties this event to the wider workflow it belongs to. */
  correlationId: CorrelationIdSchema.optional(),

  /** What caused this event to exist: a preceding command, event or job. */
  causationId: CausationIdSchema.optional(),

  aggregate: EventAggregateSchema.optional(),
};

/**
 * Build the schema for an event carrying `dataSchema` as its payload.
 *
 * The payload is always validated by the owning event's schema. The envelope
 * never falls back to an untyped record: an unvalidated `data` is how a
 * consumer ends up trusting a shape nobody agreed to.
 *
 * Payloads stay minimal -- identifiers, changed field names, and the small
 * immutable before/after values that history genuinely needs. A full aggregate,
 * a document body, private founder notes or a raw Q conversation must not
 * travel on the generic bus merely because the transport is internal.
 * Consumers re-fetch authoritative state under their own permissions.
 */
export function createEventSchema<TData extends z.ZodType>(dataSchema: TData) {
  return z.object({ ...eventEnvelopeShape, data: dataSchema });
}

/** The envelope with an unvalidated payload, for routing before schema lookup. */
export const EventEnvelopeSchema = z.object({
  ...eventEnvelopeShape,
  data: z.unknown(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export type CapitalQEvent<TData> = Omit<EventEnvelope, "data"> & {
  readonly data: TData;
};
