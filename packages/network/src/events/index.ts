import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

/**
 * Network integration events. Distinct from network.relationship_events
 * (the history): the outbox carries a minimal announcement that a canonical
 * pair now exists, so later consumers can prepare, never the origin
 * details. No generic "event appended" announcement exists; later material
 * commands publish their own typed events (e.g. network.relationship.matched).
 */

export const NETWORK_EVENT_OWNER = "@capital-q/network" as const;
export const NETWORK_EVENT_PRODUCER = "capitalq://api/network" as const;

export const RelationshipCreatedEvent = defineEvent({
  name: "network.relationship.created",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/recommendations", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "A canonical Company ↔ Investor Organisation relationship was established. Carries identifiers only; origin, scope and payload stay in the private history.",
});

/**
 * An investor organisation expressed interest in a company (CQ-NET-010).
 * Identifiers only: who acted is on the envelope's actor, and the history
 * row carries the rest. Not a match: nothing consuming this may treat it
 * as bilateral.
 */
export const RelationshipInterestExpressedEvent = defineEvent({
  name: "network.relationship.interest_expressed",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      interestId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "An investor organisation expressed unilateral interest in a company on their canonical relationship. Not a match.",
});

/**
 * The company accepted an interest and the two sides are connected
 * (CQ-NET-011). Identifiers only; not an investment, not a state.
 */
export const RelationshipMatchedEvent = defineEvent({
  name: "network.relationship.matched",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      interestId: UuidSchema,
      matchId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "The company accepted an investor organisation's interest: both sides have agreed to connect on their canonical relationship.",
});

/** The company declined an interest (CQ-NET-011). Identifiers only; no reason exists to carry. */
export const RelationshipInterestDeclinedEvent = defineEvent({
  name: "network.relationship.interest_declined",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      interestId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "The company has not taken an investor organisation's interest forward.",
});

export const NETWORK_EVENTS: readonly EventDefinition[] = [
  RelationshipCreatedEvent,
  RelationshipInterestExpressedEvent,
  RelationshipMatchedEvent,
  RelationshipInterestDeclinedEvent,
];

/** One of the company's answers, as its outbox announcement. */
export function interestAnsweredEvent(input: {
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly interestId: string;
  readonly matchId: string | null;
  readonly companyId: string;
  readonly investorOrganisationId: string;
}): CapitalQEvent<Readonly<Record<string, string>>> {
  const definition =
    input.decision === "ACCEPTED"
      ? RelationshipMatchedEvent
      : RelationshipInterestDeclinedEvent;
  const identifiers = {
    relationshipId: input.relationshipId,
    interestId: input.interestId,
    companyId: input.companyId,
    investorOrganisationId: input.investorOrganisationId,
  };
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "interest", id: input.interestId, version: 2 },
    data:
      input.decision === "ACCEPTED" && input.matchId !== null
        ? { ...identifiers, matchId: input.matchId }
        : identifiers,
  };
}

export function relationshipInterestExpressedEvent(input: {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly interestId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
}): CapitalQEvent<
  z.infer<typeof RelationshipInterestExpressedEvent.dataSchema>
> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipInterestExpressedEvent.name,
    source: RelationshipInterestExpressedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipInterestExpressedEvent.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "interest", id: input.interestId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      interestId: input.interestId,
      companyId: input.companyId,
      investorOrganisationId: input.investorOrganisationId,
    },
  };
}

export function relationshipCreatedEvent(input: {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
}): CapitalQEvent<z.infer<typeof RelationshipCreatedEvent.dataSchema>> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipCreatedEvent.name,
    source: RelationshipCreatedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipCreatedEvent.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "relationship", id: input.relationshipId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      companyId: input.companyId,
      investorOrganisationId: input.investorOrganisationId,
    },
  };
}
