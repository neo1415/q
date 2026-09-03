/**
 * @capital-q/network
 *
 * Owns: the one canonical Company ↔ Investor Organisation relationship
 * (network.relationships) and its append-only, sequence-ordered,
 * visibility-scoped history (network.relationship_events): identity, pair
 * uniqueness, ordering, provenance, the internal ensure primitive, the
 * transactional event appender and the permission-neutral query port.
 *
 * Does not own: interest (CQ-NET-010), match (CQ-NET-011), the state
 * projector (CQ-NET-012), disclosure (CQ-PERM-001), GateQ, meetings,
 * messaging, diligence, commitments, investment outcomes, recommendations,
 * the feed, or Q. No HTTP surface exists yet. Zero LLM calls.
 *
 *   Relationship ≠ Recommendation ≠ Impression ≠ Save ≠ Interest ≠ Match ≠ Deal
 *   current_state ≠ history; relationship ≠ disclosure permission;
 *   history ≠ audit ≠ outbox ≠ Q memory
 *
 * Deliberately absent from these exports: any relationship state setter,
 * any history update or delete, any relationship deletion.
 */

export {
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  toRelationshipDto,
  toRelationshipEventSummaryDto,
  type Relationship,
  type RelationshipEvent,
  type RelationshipEventActor,
  type RelationshipEventId,
  type RelationshipEventSource,
  type RelationshipId,
} from "./contracts/index.js";
export {
  RelationshipEventTypeUnknownError,
  RelationshipEventVisibilityNotAllowedError,
  RelationshipNotFoundError,
  RelationshipPartyNotFoundError,
} from "./domain/errors.js";
export {
  createRelationshipEventRegistry,
  defineRelationshipEvent,
  DiscoveredPayloadSchema,
  DiscoveredRelationshipEvent,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RELATIONSHIP_EVENT_DISCOVERED,
  type DiscoveredPayload,
  type RelationshipEventDefinition,
  type RelationshipEventRegistry,
} from "./domain/event-registry.js";

export type {
  NewRelationshipEvent,
  RelationshipEventRepository,
  RelationshipQueryPort,
  RelationshipRepository,
} from "./application/ports.js";
export type { NetworkServiceDependencies } from "./application/dependencies.js";
export {
  createEnsureRelationship,
  RESOURCE_RELATIONSHIP,
  type EnsuredRelationship,
  type EnsureRelationshipCommand,
} from "./application/ensure-relationship.js";
export {
  createRelationshipEventAppender,
  type AppendRelationshipEventInput,
  type RelationshipEventAppender,
} from "./application/append-event.js";
export {
  createNetworkService,
  type NetworkService,
  type NetworkServiceOptions,
} from "./application/service.js";

export {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
} from "./infrastructure/postgres-repositories.js";

export const PACKAGE_NAME = "@capital-q/network" as const;
