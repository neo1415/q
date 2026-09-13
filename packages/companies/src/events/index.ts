import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  MarketplaceVisibilitySchema,
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

import { COMPANY_EVENT_OWNER, COMPANY_EVENT_PRODUCER } from "./shared.js";

export { COMPANY_EVENT_OWNER, COMPANY_EVENT_PRODUCER } from "./shared.js";

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

export const CompanyVisibilityChangedEvent = defineEvent({
  name: "core.company.visibility_changed",
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
      visibility: MarketplaceVisibilitySchema,
    })
    .strict(),
  description:
    "An editor of the company chose who may see its declared profile. Consumers re-read the row; nothing here is a disclosure grant.",
});

export const COMPANY_PROFILE_EVENTS: readonly EventDefinition[] = [
  CompanyCreatedEvent,
  CompanyUpdatedEvent,
  CompanyVisibilityChangedEvent,
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

export {
  COMPANY_TEAM_EVENTS,
  CompanyMemberCreatedEvent,
  CompanyMemberUpdatedEvent,
  CompanyTeamUpdatedEvent,
  companyMemberCreatedEvent,
  companyMemberUpdatedEvent,
  companyTeamUpdatedEvent,
  FounderProfileCreatedEvent,
  FounderProfileUpdatedEvent,
  founderProfileCreatedEvent,
  founderProfileUpdatedEvent,
} from "./team.js";

import { COMPANY_TEAM_EVENTS as TEAM_EVENTS } from "./team.js";

/** Everything the Company bounded context publishes. */
export const COMPANY_EVENTS: readonly EventDefinition[] = [
  ...COMPANY_PROFILE_EVENTS,
  ...TEAM_EVENTS,
];

export function companyVisibilityChangedEvent(
  input: EnvelopeInput & {
    readonly visibility: z.infer<typeof MarketplaceVisibilitySchema>;
  },
): CapitalQEvent<z.infer<typeof CompanyVisibilityChangedEvent.dataSchema>> {
  return envelope(CompanyVisibilityChangedEvent, input, {
    companyId: input.companyId,
    version: input.version,
    visibility: input.visibility,
  });
}
