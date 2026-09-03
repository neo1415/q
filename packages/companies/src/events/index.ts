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
 * Canonical Company domain events. Owner: this bounded context. INTERNAL:
 * a company existing in a workspace is not network or public information,
 * whatever Discover may show later under its own permissions. REPLAY_SAFE:
 * consumers rebuild derived state and re-read the profile under their own
 * authority. Payloads carry identifiers, the version and changed field
 * names only.
 */

export const COMPANY_EVENT_OWNER = "@capital-q/companies" as const;
export const COMPANY_EVENT_PRODUCER = "capitalq://api/core/company" as const;

export const CompanyCreatedEvent = defineEvent({
  name: "core.company.created",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/evidence", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      companyId: UuidSchema,
      organisationId: UuidSchema,
      version: z.number().int().min(1),
    })
    .strict(),
  description:
    "The canonical company for a business was created in its organisation's workspace.",
});

export const CompanyUpdatedEvent = defineEvent({
  name: "core.company.updated",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/evidence", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      companyId: UuidSchema,
      version: z.number().int().min(1),
      changedFields: z.array(z.string().min(1).max(64)).min(1).max(16),
    })
    .strict(),
  description:
    "The canonical company profile changed; consumers re-read the fields they need.",
});

export const COMPANY_EVENTS: readonly EventDefinition[] = [
  CompanyCreatedEvent,
  CompanyUpdatedEvent,
];

type EnvelopeInput = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly companyId: string;
  readonly version: number;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
};

function envelope<TData>(
  definition: EventDefinition,
  input: EnvelopeInput,
  data: TData,
): CapitalQEvent<TData> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `company/${input.companyId}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "company", id: input.companyId, version: input.version },
    data,
  };
}

export function companyCreatedEvent(
  input: EnvelopeInput,
): CapitalQEvent<z.infer<typeof CompanyCreatedEvent.dataSchema>> {
  return envelope(CompanyCreatedEvent, input, {
    companyId: input.companyId,
    organisationId: input.organisationId,
    version: input.version,
  });
}

export function companyUpdatedEvent(
  input: EnvelopeInput & { readonly changedFields: readonly string[] },
): CapitalQEvent<z.infer<typeof CompanyUpdatedEvent.dataSchema>> {
  return envelope(CompanyUpdatedEvent, input, {
    companyId: input.companyId,
    version: input.version,
    changedFields: [...input.changedFields],
  });
}
