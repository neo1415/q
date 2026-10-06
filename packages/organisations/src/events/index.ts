import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  OrganisationTypeSchema,
  UuidSchema,
  UtcTimestampSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

/**
 * Canonical organisation domain events. Owner: this bounded context.
 * Producer: the API's organisation application service. INTERNAL, because a
 * workspace existing is not public information; REPLAY_SAFE, because every
 * consumer rebuilds derived state and re-fetches authority under its own
 * permissions. Payloads carry identifiers and changed field names only.
 */

export const ORGANISATION_EVENT_OWNER = "@capital-q/organisations" as const;
export const ORGANISATION_EVENT_PRODUCER =
  "capitalq://api/identity/organisation" as const;

export const OrganisationCreatedEvent = defineEvent({
  name: "identity.organisation.created",
  version: 1,
  owner: ORGANISATION_EVENT_OWNER,
  producer: ORGANISATION_EVENT_PRODUCER,
  consumers: ["@capital-q/companies", "@capital-q/investors"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      organisationId: UuidSchema,
      organisationType: OrganisationTypeSchema,
    })
    .strict(),
  description:
    "An organisation workspace was created together with its tenant and the creator's membership.",
});

export const OrganisationUpdatedEvent = defineEvent({
  name: "identity.organisation.updated",
  version: 1,
  owner: ORGANISATION_EVENT_OWNER,
  producer: ORGANISATION_EVENT_PRODUCER,
  consumers: ["@capital-q/companies", "@capital-q/investors"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      organisationId: UuidSchema,
      version: z.number().int().min(1),
      changedFields: z.array(z.string().min(1).max(64)).min(1).max(16),
    })
    .strict(),
  description:
    "An organisation's profile changed; consumers re-read the fields they need.",
});

export const MembershipCreatedEvent = defineEvent({
  name: "identity.membership.created",
  version: 1,
  owner: ORGANISATION_EVENT_OWNER,
  producer: ORGANISATION_EVENT_PRODUCER,
  consumers: ["@capital-q/companies", "@capital-q/investors"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      membershipId: UuidSchema,
      organisationId: UuidSchema,
      userId: UuidSchema,
      membershipStatus: z.enum(["active"]),
    })
    .strict(),
  description:
    "A person became a member of an organisation. Roles are not carried; authority is resolved from policy.",
});

// G1/G2: a membership ended (left or removed) or changed role. Consumers
// re-resolve authority; a removed person's running Q work already stops at
// its next step, because their membership no longer resolves.
export const MembershipEndedEvent = defineEvent({
  name: "identity.membership.ended",
  version: 1,
  owner: ORGANISATION_EVENT_OWNER,
  producer: ORGANISATION_EVENT_PRODUCER,
  consumers: [],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      membershipId: UuidSchema,
      organisationId: UuidSchema,
      userId: UuidSchema,
      membershipStatus: z.enum(["left", "revoked"]),
      /** Who picks up their open work (a removal); null when they left. */
      handedOverToUserId: UuidSchema.nullable(),
    })
    .strict(),
  description:
    "A person stopped being a member of an organisation, by leaving or being removed.",
});

export const MembershipRoleChangedEvent = defineEvent({
  name: "identity.membership.role_changed",
  version: 1,
  owner: ORGANISATION_EVENT_OWNER,
  producer: ORGANISATION_EVENT_PRODUCER,
  consumers: [],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      membershipId: UuidSchema,
      organisationId: UuidSchema,
      userId: UuidSchema,
      role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
    })
    .strict(),
  description:
    "A member's team role changed (Owner, Admin or Member). Authority is re-resolved from policy.",
});

/** Everything this context publishes. Registered by the API and the worker. */
export const ORGANISATION_EVENTS: readonly EventDefinition[] = [
  OrganisationCreatedEvent,
  OrganisationUpdatedEvent,
  MembershipCreatedEvent,
  MembershipEndedEvent,
  MembershipRoleChangedEvent,
];

type EnvelopeInput = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
};

function envelope<TData>(
  definition: EventDefinition,
  input: EnvelopeInput,
  aggregate: {
    readonly type: string;
    readonly id: string;
    readonly version?: number;
  },
  data: TData,
): CapitalQEvent<TData> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `${aggregate.type}/${aggregate.id}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate:
      aggregate.version === undefined
        ? { type: aggregate.type, id: aggregate.id }
        : {
            type: aggregate.type,
            id: aggregate.id,
            version: aggregate.version,
          },
    data,
  };
}

export function organisationCreatedEvent(
  input: EnvelopeInput & {
    readonly organisationType: z.infer<typeof OrganisationTypeSchema>;
  },
): CapitalQEvent<z.infer<typeof OrganisationCreatedEvent.dataSchema>> {
  return envelope(
    OrganisationCreatedEvent,
    input,
    { type: "organisation", id: input.organisationId, version: 1 },
    {
      organisationId: input.organisationId,
      organisationType: input.organisationType,
    },
  );
}

export function organisationUpdatedEvent(
  input: EnvelopeInput & {
    readonly version: number;
    readonly changedFields: readonly string[];
  },
): CapitalQEvent<z.infer<typeof OrganisationUpdatedEvent.dataSchema>> {
  return envelope(
    OrganisationUpdatedEvent,
    input,
    { type: "organisation", id: input.organisationId, version: input.version },
    {
      organisationId: input.organisationId,
      version: input.version,
      changedFields: [...input.changedFields],
    },
  );
}

export function membershipCreatedEvent(
  input: EnvelopeInput & {
    readonly membershipId: string;
    readonly userId: string;
  },
): CapitalQEvent<z.infer<typeof MembershipCreatedEvent.dataSchema>> {
  return envelope(
    MembershipCreatedEvent,
    input,
    { type: "membership", id: input.membershipId, version: 1 },
    {
      membershipId: input.membershipId,
      organisationId: input.organisationId,
      userId: input.userId,
      membershipStatus: "active",
    },
  );
}

export function membershipEndedEvent(
  input: EnvelopeInput & {
    readonly membershipId: string;
    readonly userId: string;
    readonly status: "left" | "revoked";
    readonly handedOverToUserId: string | null;
  },
): CapitalQEvent<z.infer<typeof MembershipEndedEvent.dataSchema>> {
  return envelope(
    MembershipEndedEvent,
    input,
    { type: "membership", id: input.membershipId },
    {
      membershipId: input.membershipId,
      organisationId: input.organisationId,
      userId: input.userId,
      membershipStatus: input.status,
      handedOverToUserId: input.handedOverToUserId,
    },
  );
}

export function membershipRoleChangedEvent(
  input: EnvelopeInput & {
    readonly membershipId: string;
    readonly userId: string;
    readonly role: string;
  },
): CapitalQEvent<z.infer<typeof MembershipRoleChangedEvent.dataSchema>> {
  const role =
    input.role === "OWNER" || input.role === "ADMIN" ? input.role : "MEMBER";
  return envelope(
    MembershipRoleChangedEvent,
    input,
    { type: "membership", id: input.membershipId },
    {
      membershipId: input.membershipId,
      organisationId: input.organisationId,
      userId: input.userId,
      role,
    },
  );
}
