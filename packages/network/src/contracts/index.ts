import { z } from "zod";

import type { CompanyId } from "@capital-q/companies";
import {
  createUuidIdSchema,
  type CorrelationId,
  type DisclosureScope,
  type ConnectionDto,
  type IncomingInterestDto,
  type InterestDto,
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

// ---------------------------------------------------------------------------
// Interest (CQ-NET-010)
// ---------------------------------------------------------------------------

/** The interest record's identifier. Never a RelationshipId or a history event id. */
export const InterestIdSchema = createUuidIdSchema("InterestId");
export type InterestId = z.infer<typeof InterestIdSchema>;

/** The company's answer to an interest (CQ-NET-011). */
export const InterestResponseIdSchema =
  createUuidIdSchema("InterestResponseId");
export type InterestResponseId = z.infer<typeof InterestResponseIdSchema>;

/** The formal bilateral connection: doc 13's `network.matches` row. */
export const MatchIdSchema = createUuidIdSchema("MatchId");
export type MatchId = z.infer<typeof MatchIdSchema>;

export type InterestDecision = "ACCEPTED" | "DECLINED";

/**
 * An investor organisation's unilateral interest in a company, on the one
 * canonical relationship. Interest ≠ Match: the interest itself is never
 * bilateral, and the relationship's projected state is not changed by it.
 * `response` and `connection` are the company's answer (CQ-NET-011), read
 * with it so neither side ever sees an interest without its answer.
 */
export type Interest = {
  readonly id: InterestId;
  /** The relationship's (company's) tenant anchor. */
  readonly tenantId: TenantId;
  readonly relationshipId: RelationshipId;
  readonly companyId: CompanyId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly expressedByParty: "INVESTOR";
  readonly status: "EXPRESSED" | "WITHDRAWN";
  readonly expressedByUserId: string;
  readonly expressedInOrganisationId: string;
  readonly relationshipEventId: RelationshipEventId;
  readonly createdAt: UtcTimestamp;
  /** Null until the company answers. */
  readonly response: {
    readonly id: InterestResponseId;
    readonly decision: InterestDecision;
    readonly respondedAt: UtcTimestamp;
  } | null;
  /** The match an acceptance opened; null otherwise. */
  readonly connection: {
    readonly id: MatchId;
    readonly status: "ACTIVE" | "ENDED";
    readonly connectedAt: UtcTimestamp;
  } | null;
};

function connectionDto(interest: Interest): ConnectionDto | null {
  return interest.connection === null
    ? null
    : {
        connectionId: interest.connection.id,
        status: interest.connection.status,
        connectedAt: interest.connection.connectedAt,
      };
}

export function toInterestDto(interest: Interest): InterestDto {
  return {
    interestId: interest.id,
    relationshipId: interest.relationshipId,
    companyId: interest.companyId,
    status: interest.status,
    expressedAt: interest.createdAt,
    response: interest.response?.decision ?? "PENDING",
    respondedAt: interest.response?.respondedAt ?? null,
    connection: connectionDto(interest),
  };
}

/**
 * The company's view of an incoming interest. Names the investor
 * organisation -- the interest was addressed to the company -- and never
 * the person who acted for it.
 */
export function toIncomingInterestDto(
  interest: Interest,
  investor: { readonly displayName: string; readonly investorType: string },
): IncomingInterestDto {
  return {
    interestId: interest.id,
    investorOrganisationId: interest.investorOrganisationId,
    investorName: investor.displayName,
    investorType: investor.investorType,
    expressedAt: interest.createdAt,
    response: interest.response?.decision ?? "PENDING",
    respondedAt: interest.response?.respondedAt ?? null,
    connection: connectionDto(interest),
  };
}
