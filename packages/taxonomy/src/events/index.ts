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
 * Taxonomy integration events. One event for confirmed entity
 * classification changes; identifiers and vocabulary codes only -- never
 * the raw source text, node set or any private description. Consumers
 * re-read authorised state. Investor mandate taxonomy preferences are
 * announced by the existing `core.investor_mandate.updated` event (change
 * kind TAXONOMY); no second event describes the same mutation.
 */

export const TAXONOMY_EVENT_OWNER = "@capital-q/taxonomy" as const;
export const TAXONOMY_EVENT_PRODUCER = "capitalq://api/taxonomy" as const;

export const EntityAssignmentsChangedEvent = defineEvent({
  name: "taxonomy.entity_assignments.changed",
  version: 1,
  owner: TAXONOMY_EVENT_OWNER,
  producer: TAXONOMY_EVENT_PRODUCER,
  consumers: [
    "@capital-q/recommendations",
    "@capital-q/q",
    "@capital-q/discovery",
  ],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      subjectType: z.enum(["COMPANY"]),
      subjectId: UuidSchema,
      changedVocabularyCodes: z
        .array(
          z
            .string()
            .regex(/^[a-z][a-z0-9_]*$/)
            .max(64),
        )
        .min(1)
        .max(16),
    })
    .strict(),
  description:
    "The confirmed canonical classification of an entity changed in the named vocabularies. Carries no node ids, raw text or descriptions.",
});

export const TAXONOMY_EVENTS: readonly EventDefinition[] = [
  EntityAssignmentsChangedEvent,
];

export function entityAssignmentsChangedEvent(input: {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly subjectType: "COMPANY";
  readonly subjectId: string;
  readonly changedVocabularyCodes: readonly string[];
}): CapitalQEvent<z.infer<typeof EntityAssignmentsChangedEvent.dataSchema>> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: EntityAssignmentsChangedEvent.name,
    source: EntityAssignmentsChangedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `${input.subjectType.toLowerCase()}/${input.subjectId}`,
    dataContentType: "application/json",
    eventVersion: EntityAssignmentsChangedEvent.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "company", id: input.subjectId },
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      changedVocabularyCodes: [...input.changedVocabularyCodes],
    },
  };
}
