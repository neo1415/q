/**
 * @capital-q/network
 *
 * Owns: the one canonical Company ↔ Investor Organisation relationship
 * (network.relationships) and its append-only, sequence-ordered,
 * visibility-scoped history (network.relationship_events): identity, pair
 * uniqueness, ordering, provenance, the internal ensure primitive, the
 * transactional event appender and the permission-neutral query port;
 * Express Interest (CQ-NET-010: network.interests, the authorised command,
 * its idempotency record and `interest_expressed`); and the company's
 * answer (CQ-NET-011: network.interest_responses, network.matches,
 * `connection_accepted` and `interest_declined`).
 *
 * Does not own: the state projector (CQ-NET-012), disclosure
 * (CQ-PERM-001), GateQ, meetings, messaging, diligence, commitments,
 * investment outcomes, recommendations, the feed, or Q. Zero LLM calls.
 *
 *   Relationship ≠ Recommendation ≠ Impression ≠ Save ≠ Interest ≠ Match ≠ Deal
 *   current_state ≠ history; relationship ≠ disclosure permission;
 *   history ≠ audit ≠ outbox ≠ Q memory
 *
 * Deliberately absent from these exports: any relationship state setter,
 * any history update or delete, any relationship deletion, any way to
 * overwrite an answer or end a match.
 */

export {
  InterestIdSchema,
  InterestResponseIdSchema,
  MatchIdSchema,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  toIncomingInterestDto,
  toInterestDto,
  toRelationshipDto,
  toRelationshipEventSummaryDto,
  type Interest,
  type InterestDecision,
  type InterestId,
  type InterestResponseId,
  type MatchId,
  type Relationship,
  type RelationshipEvent,
  type RelationshipEventActor,
  type RelationshipEventId,
  type RelationshipEventSource,
  type RelationshipId,
} from "./contracts/index.js";
export {
  InterestAlreadyAnsweredError,
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestNotFoundError,
  InterestNotPermittedError,
  RelationshipEventTypeUnknownError,
  RelationshipEventVisibilityNotAllowedError,
  RelationshipNotFoundError,
  RelationshipPartyNotFoundError,
} from "./domain/errors.js";
export {
  ConnectionAcceptedPayloadSchema,
  ConnectionAcceptedRelationshipEvent,
  createRelationshipEventRegistry,
  defineRelationshipEvent,
  DiscoveredPayloadSchema,
  DiscoveredRelationshipEvent,
  InterestExpressedPayloadSchema,
  InterestDeclinedPayloadSchema,
  InterestDeclinedRelationshipEvent,
  InterestExpressedRelationshipEvent,
  RELATIONSHIP_EVENT_CONNECTION_ACCEPTED,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RELATIONSHIP_EVENT_DISCOVERED,
  RELATIONSHIP_EVENT_INTEREST_DECLINED,
  RELATIONSHIP_EVENT_INTEREST_EXPRESSED,
  type ConnectionAcceptedPayload,
  type DiscoveredPayload,
  type InterestDeclinedPayload,
  type InterestExpressedPayload,
  type RelationshipEventDefinition,
  type RelationshipEventRegistry,
} from "./domain/event-registry.js";

export type {
  InterestRepository,
  InterestRequestStore,
  InterestResponseRepository,
  InterestResponseRequestStore,
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
  createEnsureRelationshipInTransaction,
  resolveRelationshipParties,
} from "./application/ensure-relationship.js";
export {
  createExpressInterest,
  createGetOwnInterest,
  createMayExpressInterest,
  hashExpressInterestRequest,
  hashInterestIdempotencyKey,
  INVESTOR_INTEREST_EXPRESS,
  type ExpressInterestCommand,
  type ExpressInterestDependencies,
  type ExpressInterestResult,
  type InterestSurface,
} from "./application/express-interest.js";
export {
  COMPANY_INTEREST_RESPOND,
  COMPANY_INTEREST_VIEW,
  createListIncomingInterest,
  createMayRespondToInterest,
  createRespondToInterest,
  hashInterestResponseIdempotencyKey,
  hashRespondToInterestRequest,
  type IncomingInterest,
  type InterestResponseSurface,
  type RespondToInterestCommand,
  type RespondToInterestResult,
} from "./application/respond-to-interest.js";
export {
  createRelationshipStateProjector,
  readHistory,
  type RelationshipStateProjector,
} from "./application/relationship-projection.js";
export {
  createRelationshipForCompany,
  createRelationshipForInvestor,
  toRelationshipStatusDto,
  type RelationshipStatus,
} from "./application/relationship-status.js";
export {
  nextStepFor,
  projectRelationshipState,
  RELATIONSHIP_PROJECTOR_VERSION,
  RELATIONSHIP_STATE_TRANSITIONS,
  visibleToParty,
  type ProjectableEvent,
  type RelationshipNextStep,
  type RelationshipParty,
  type RelationshipProjection,
} from "./domain/state-projector.js";
export {
  createInterestService,
  createNetworkService,
  type InterestService,
  type InterestServiceOptions,
  type NetworkService,
  type NetworkServiceOptions,
} from "./application/service.js";

export {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
} from "./infrastructure/postgres-repositories.js";
export {
  createPostgresInterestRepository,
  createPostgresInterestRequestStore,
  createPostgresInterestResponseRepository,
  createPostgresInterestResponseRequestStore,
} from "./infrastructure/postgres-interest-repositories.js";

export const PACKAGE_NAME = "@capital-q/network" as const;
