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

import { COMPANY_EVENT_OWNER, COMPANY_EVENT_PRODUCER } from "./shared.js";

/**
 * Founder / team events. Identifiers, versions and changed field names only.
 * Founder-profile events are CONFIDENTIAL and still carry no profile text:
 * a summary is never on the bus, whatever the classification.
 */

const changedFields = z.array(z.string().min(1).max(64)).min(1).max(16);

export const CompanyMemberCreatedEvent = defineEvent({
  name: "core.company_member.created",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      companyMemberId: UuidSchema,
      companyId: UuidSchema,
      userId: UuidSchema,
      isFounder: z.boolean(),
    })
    .strict(),
  description:
    "A person's relationship to a company began (a new current period).",
});

export const CompanyMemberUpdatedEvent = defineEvent({
  name: "core.company_member.updated",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      companyMemberId: UuidSchema,
      companyId: UuidSchema,
      version: z.number().int().min(1),
      changedFields,
    })
    .strict(),
  description: "A person's current relationship to a company changed.",
});

export const FounderProfileCreatedEvent = defineEvent({
  name: "core.founder_profile.created",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      founderProfileId: UuidSchema,
      userId: UuidSchema,
      primaryCompanyId: UuidSchema.nullable(),
      version: z.number().int().min(1),
    })
    .strict(),
  description:
    "A person created their founder profile. Carries no profile text.",
});

export const FounderProfileUpdatedEvent = defineEvent({
  name: "core.founder_profile.updated",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      founderProfileId: UuidSchema,
      userId: UuidSchema,
      primaryCompanyId: UuidSchema.nullable(),
      version: z.number().int().min(1),
      changedFields,
    })
    .strict(),
  description:
    "A person changed their founder profile. Carries no profile text.",
});

export const CompanyTeamUpdatedEvent = defineEvent({
  name: "core.company_team.updated",
  version: 1,
  owner: COMPANY_EVENT_OWNER,
  producer: COMPANY_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      companyId: UuidSchema,
      version: z.number().int().min(1),
      changedFields,
    })
    .strict(),
  description: "A company's self-reported team facts changed.",
});

export const COMPANY_TEAM_EVENTS: readonly EventDefinition[] = [
  CompanyMemberCreatedEvent,
  CompanyMemberUpdatedEvent,
  FounderProfileCreatedEvent,
  FounderProfileUpdatedEvent,
  CompanyTeamUpdatedEvent,
];

type Context = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
};

function envelope<TData>(
  definition: EventDefinition,
  context: Context,
  aggregate: {
    readonly type: string;
    readonly id: string;
    readonly version: number;
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
    tenantId: context.tenantId,
    organisationId: context.organisationId,
    actor: { type: "HUMAN", id: context.actorUserId },
    correlationId: context.correlationId,
    aggregate,
    data,
  };
}

export function companyMemberCreatedEvent(
  input: Context & {
    readonly companyMemberId: string;
    readonly companyId: string;
    readonly userId: string;
    readonly isFounder: boolean;
    readonly version: number;
  },
) {
  return envelope(
    CompanyMemberCreatedEvent,
    input,
    {
      type: "company_member",
      id: input.companyMemberId,
      version: input.version,
    },
    {
      companyMemberId: input.companyMemberId,
      companyId: input.companyId,
      userId: input.userId,
      isFounder: input.isFounder,
    },
  );
}

export function companyMemberUpdatedEvent(
  input: Context & {
    readonly companyMemberId: string;
    readonly companyId: string;
    readonly version: number;
    readonly changedFields: readonly string[];
  },
) {
  return envelope(
    CompanyMemberUpdatedEvent,
    input,
    {
      type: "company_member",
      id: input.companyMemberId,
      version: input.version,
    },
    {
      companyMemberId: input.companyMemberId,
      companyId: input.companyId,
      version: input.version,
      changedFields: [...input.changedFields],
    },
  );
}

export function founderProfileCreatedEvent(
  input: Context & {
    readonly founderProfileId: string;
    readonly userId: string;
    readonly primaryCompanyId: string | null;
    readonly version: number;
  },
) {
  return envelope(
    FounderProfileCreatedEvent,
    input,
    {
      type: "founder_profile",
      id: input.founderProfileId,
      version: input.version,
    },
    {
      founderProfileId: input.founderProfileId,
      userId: input.userId,
      primaryCompanyId: input.primaryCompanyId,
      version: input.version,
    },
  );
}

export function founderProfileUpdatedEvent(
  input: Context & {
    readonly founderProfileId: string;
    readonly userId: string;
    readonly primaryCompanyId: string | null;
    readonly version: number;
    readonly changedFields: readonly string[];
  },
) {
  return envelope(
    FounderProfileUpdatedEvent,
    input,
    {
      type: "founder_profile",
      id: input.founderProfileId,
      version: input.version,
    },
    {
      founderProfileId: input.founderProfileId,
      userId: input.userId,
      primaryCompanyId: input.primaryCompanyId,
      version: input.version,
      changedFields: [...input.changedFields],
    },
  );
}

export function companyTeamUpdatedEvent(
  input: Context & {
    readonly companyId: string;
    readonly version: number;
    readonly changedFields: readonly string[];
  },
) {
  return envelope(
    CompanyTeamUpdatedEvent,
    input,
    { type: "company_team", id: input.companyId, version: input.version },
    {
      companyId: input.companyId,
      version: input.version,
      changedFields: [...input.changedFields],
    },
  );
}
