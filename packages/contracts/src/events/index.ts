/**
 * Domain events: material facts that have already happened.
 *
 * Distinct from the three systems most often confused with them:
 *
 *   JOB        instructs work to be performed (see ../jobs)
 *   AUDIT      records who acted under whose authority (CQ-SEC-003)
 *   ANALYTICS  records observed product behaviour
 *
 * A domain event is canonical business truth. Analytics may be lost without
 * losing relationship state, permission state or a match; a domain event may
 * not. Audit answers a different question about the same moment and is a
 * separate durable record, not a subclass of this envelope.
 *
 * Q streaming messages -- run.started, stage.changed, message.delta -- are a
 * transport concern for live UI, not durable domain events, and are not
 * registered here.
 *
 * Clients never manufacture domain events. A browser issues an HTTP command and
 * server-side business logic decides whether a fact occurred.
 */

export {
  createEventSchema,
  EVENT_ACTOR_TYPES,
  EVENT_SPEC_VERSION,
  EventActorSchema,
  EventAggregateSchema,
  EventEnvelopeSchema,
  EventIdSchema,
  EventSourceSchema,
  EventTypeSchema,
  type CapitalQEvent,
  type EventActor,
  type EventAggregate,
  type EventEnvelope,
  type EventId,
  type EventType,
} from "./envelope.js";

export {
  defineEvent,
  EVENT_TENANCIES,
  eventKey,
  EventTenancySchema,
  isTenantOwnedEvent,
  type EventDefinition,
  type EventTenancy,
} from "./definition.js";

export { createEventRegistry, type EventRegistry } from "./registry.js";
