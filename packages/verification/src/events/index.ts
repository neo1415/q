import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  UtcTimestampSchema,
  UuidSchema,
  VerificationClaimStatusSchema,
  VerificationClaimTypeSchema,
  VerificationMethodSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventActor,
  type EventDefinition,
} from "@capital-q/contracts";

/**
 * Verification domain events. Identifiers and coded states only: never a
 * person's name, never the decision basis prose, never anything a founder
 * submitted. A consumer that needs more reads the row under its own
 * authority.
 */

export const VERIFICATION_EVENT_OWNER = "@capital-q/verification" as const;
const PRODUCER_API = "capitalq://api/verification" as const;
const PRODUCER_WORKER = "capitalq://workers/verification" as const;

export const VerificationClaimRecordedEvent = defineEvent({
  name: "verification.claim.recorded",
  version: 1,
  owner: VERIFICATION_EVENT_OWNER,
  producer: PRODUCER_API,
  consumers: ["@capital-q/workers"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      claimId: UuidSchema,
      claimType: VerificationClaimTypeSchema,
      status: VerificationClaimStatusSchema,
      revision: z.number().int().min(1),
    })
    .strict(),
  description:
    "Someone asked Capital Q to verify a claim; a PENDING row exists. Nothing is verified by this event.",
});

export const VerificationClaimDecidedEvent = defineEvent({
  name: "verification.claim.decided",
  version: 1,
  owner: VERIFICATION_EVENT_OWNER,
  producer: PRODUCER_WORKER,
  consumers: ["@capital-q/workers"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      claimId: UuidSchema,
      decidesClaimId: UuidSchema,
      claimType: VerificationClaimTypeSchema,
      status: VerificationClaimStatusSchema,
      method: VerificationMethodSchema,
      revision: z.number().int().min(1),
    })
    .strict(),
  description:
    "Capital Q decided a verification claim; the decision row names the request it answers and how it was decided.",
});

export const VERIFICATION_EVENTS: readonly EventDefinition[] = [
  VerificationClaimRecordedEvent,
  VerificationClaimDecidedEvent,
];

type EnvelopeContext = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actor: EventActor;
  readonly correlationId: CorrelationId;
};

function envelope<TData>(
  definition: EventDefinition,
  context: EnvelopeContext,
  aggregate: { readonly id: string; readonly version: number },
  data: TData,
): CapitalQEvent<TData> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `verification_claim/${aggregate.id}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: context.tenantId,
    organisationId: context.organisationId,
    actor: context.actor,
    correlationId: context.correlationId,
    aggregate: { type: "verification_claim", ...aggregate },
    data,
  };
}

export function verificationClaimRecordedEvent(
  context: EnvelopeContext,
  data: z.infer<typeof VerificationClaimRecordedEvent.dataSchema>,
) {
  return envelope(
    VerificationClaimRecordedEvent,
    context,
    { id: data.claimId, version: data.revision },
    data,
  );
}

export function verificationClaimDecidedEvent(
  context: EnvelopeContext,
  data: z.infer<typeof VerificationClaimDecidedEvent.dataSchema>,
) {
  return envelope(
    VerificationClaimDecidedEvent,
    context,
    { id: data.claimId, version: data.revision },
    data,
  );
}
