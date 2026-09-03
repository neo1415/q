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

export const NETWORK_EVENTS: readonly EventDefinition[] = [
  RelationshipCreatedEvent,
];

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
