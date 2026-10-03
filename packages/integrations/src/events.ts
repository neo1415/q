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
 * Integrations domain events. Identifiers and counts only: never the
 * sender, the subject or a word of the body. Consumers re-read the row as
 * the person through the integrations context.
 */

export const INTEGRATIONS_EVENT_OWNER = "@capital-q/integrations" as const;
export const INTEGRATIONS_EVENT_PRODUCER = "capitalq://api/integrations" as const;

export const InboundEmailReceivedEvent = defineEvent({
  name: "integrations.inbound_email.received",
  version: 1,
  owner: INTEGRATIONS_EVENT_OWNER,
  producer: INTEGRATIONS_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      inboundEmailId: UuidSchema,
      recipientUserId: UuidSchema,
      attachmentCount: z.number().int().min(0).max(50),
    })
    .strict(),
  description:
    "An email arrived at a person's Q address and was stored. Carries no sender, subject or content.",
});

export const INTEGRATIONS_EVENTS: readonly EventDefinition[] = [
  InboundEmailReceivedEvent,
];

export type InboundEmailReceivedData = z.infer<
  typeof InboundEmailReceivedEvent.dataSchema
>;

export function inboundEmailReceivedEvent(input: {
  readonly tenantId: string;
  readonly correlationId: CorrelationId;
  readonly inboundEmailId: string;
  readonly recipientUserId: string;
  readonly attachmentCount: number;
}): CapitalQEvent<InboundEmailReceivedData> {
  return {
    specVersion: "1.0",
    // Derived from the row, so a replayed transaction is the same event.
    id: EventIdSchema.parse(input.inboundEmailId),
    type: InboundEmailReceivedEvent.name,
    source: InboundEmailReceivedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `inbound_email/${input.inboundEmailId}`,
    dataContentType: "application/json",
    eventVersion: InboundEmailReceivedEvent.version,
    tenantId: input.tenantId,
    actor: { type: "SYSTEM" },
    correlationId: input.correlationId,
    aggregate: { type: "inbound_email", id: input.inboundEmailId },
    data: {
      inboundEmailId: input.inboundEmailId,
      recipientUserId: input.recipientUserId,
      attachmentCount: input.attachmentCount,
    },
  };
}
