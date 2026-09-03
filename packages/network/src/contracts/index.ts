import { z } from "zod";

import type { CompanyId } from "@capital-q/companies";
import {
  createUuidIdSchema,
  type CorrelationId,
  type DisclosureScope,
  type RelationshipDto,
  type RelationshipEventSummaryDto,
  type RelationshipSourceType,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { InvestorOrganisationId } from "@capital-q/investors";
import type { ActorType, TenantId } from "@capital-q/security";

/**
 * @capital-q/network/contracts
 *
 * The safe public surface of the Network bounded context: the canonical
 * identifiers, the relationship entity, the relationship event entity and
 * the DTO mappings. No persistence, no use cases, no disclosure decisions.
 *
 *   Relationship ≠ Recommendation ≠ Impression ≠ Save ≠ Interest ≠ Match ≠ Deal
 *   current_state ≠ authoritative history; relationship ≠ disclosure permission
 */

/** The canonical relationship identifier. Never a CompanyId, InvestorOrganisationId or OrganisationId. */
export const RelationshipIdSchema = createUuidIdSchema("RelationshipId");
export type RelationshipId = z.infer<typeof RelationshipIdSchema>;

/** One history row. Distinct from the outbox event id, the audit event id and the relationship id. */
export const RelationshipEventIdSchema = createUuidIdSchema(
  "RelationshipEventId",
);
export type RelationshipEventId = z.infer<typeof RelationshipEventIdSchema>;

export type Relationship = {
  readonly id: RelationshipId;
  /** The company's tenant: a storage anchor (ADR 0003), never bilateral authorisation. */
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly investorOrganisationId: InvestorOrganisationId;
  /** Derived projection. Only DISCOVERED is written by this foundation. */
  readonly currentState: string;
  readonly stateUpdatedAt: UtcTimestamp;
  /** Earliest material origin. Immutable. */
  readonly firstDiscoveredAt: UtcTimestamp;
  readonly lastEventSequence: number;
  readonly createdAt: UtcTimestamp;
};

/** Who acted on a relationship event, in the canonical actor vocabulary. */
export type RelationshipEventActor = {
  readonly type: ActorType;
  /** A HUMAN actor's canonical UserId; a system or Q principal id otherwise. */
  readonly id: string;
};

export type RelationshipEventSource = {
  readonly type: RelationshipSourceType;
  readonly id: string | null;
};

export type RelationshipEvent = {
  readonly id: RelationshipEventId;
  readonly tenantId: TenantId;
  readonly relationshipId: RelationshipId;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: UtcTimestamp;
  readonly actor: RelationshipEventActor;
  readonly source: RelationshipEventSource;
  readonly visibilityScope: DisclosureScope;
  /** Validated against the registered schema for `eventType`. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
  readonly createdAt: UtcTimestamp;
};

/** Summary shape. The tenant anchor is internal and absent. */
export function toRelationshipDto(relationship: Relationship): RelationshipDto {
  return {
    id: relationship.id,
    companyId: relationship.companyId,
    investorOrganisationId: relationship.investorOrganisationId,
    currentState: relationship.currentState,
    firstDiscoveredAt: relationship.firstDiscoveredAt,
    stateUpdatedAt: relationship.stateUpdatedAt,
    lastEventSequence: relationship.lastEventSequence,
  };
}

/** Event summary without payload: payload exposure is a per-type, per-party disclosure decision. */
export function toRelationshipEventSummaryDto(
  event: RelationshipEvent,
): RelationshipEventSummaryDto {
  return {
    id: event.id,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    actorType: event.actor.type,
    actorId: event.actor.id,
    sourceType: event.source.type,
    sourceId: event.source.id,
    visibilityScope: event.visibilityScope,
    correlationId: event.correlationId,
  };
}
