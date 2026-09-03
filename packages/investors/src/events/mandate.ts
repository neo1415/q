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

import { INVESTOR_EVENT_OWNER, INVESTOR_EVENT_PRODUCER } from "./shared.js";

/**
 * Declared-mandate events. CONFIDENTIAL: a mandate is investor-private
 * policy. Payloads carry identifiers, versions, changed field names and
 * change categories only -- never cheque figures, constraint values, hard
 * exclusion contents or raw mandate text. A future recommendation consumer
 * can see that HARD_EXCLUSION changed (high-priority invalidation) without
 * learning what the exclusion is; it re-reads the mandate under its own
 * authority.
 */

export const MANDATE_CHANGE_KINDS = [
  "NAME",
  "CHEQUE",
  "STAGE",
  "GEOGRAPHY",
  "PREFERENCE",
  "HARD_EXCLUSION",
  "DISCOVERY_MODE",
  "RAW_TEXT",
] as const;
export const MandateChangeKindSchema = z.enum(MANDATE_CHANGE_KINDS);
export type MandateChangeKind = z.infer<typeof MandateChangeKindSchema>;

const changedFields = z.array(z.string().min(1).max(64)).min(1).max(16);
const changeKinds = z.array(MandateChangeKindSchema).min(1).max(8);
const version = z.number().int().min(1);

const CONSUMERS = [
  "@capital-q/onboarding",
  "@capital-q/recommendations",
  "@capital-q/q",
];

export const InvestorMandateCreatedEvent = defineEvent({
  name: "core.investor_mandate.created",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorMandateId: UuidSchema,
      investorOrganisationId: UuidSchema,
      version,
    })
    .strict(),
  description: "A declared mandate was created (DRAFT). Carries no policy.",
});

export const InvestorMandateUpdatedEvent = defineEvent({
  name: "core.investor_mandate.updated",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorMandateId: UuidSchema,
      investorOrganisationId: UuidSchema,
      version,
      changedFields,
      changeKinds,
    })
    .strict(),
  description:
    "Declared mandate policy changed. changeKinds names categories (e.g. HARD_EXCLUSION) so consumers can prioritise, without any values.",
});

export const InvestorMandateActivatedEvent = defineEvent({
  name: "core.investor_mandate.activated",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorMandateId: UuidSchema,
      investorOrganisationId: UuidSchema,
      version,
      effectiveFrom: UtcTimestampSchema,
    })
    .strict(),
  description: "A declared mandate became ACTIVE.",
});

export const InvestorMandateClosedEvent = defineEvent({
  name: "core.investor_mandate.closed",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorMandateId: UuidSchema,
      investorOrganisationId: UuidSchema,
      version,
      effectiveTo: UtcTimestampSchema,
    })
    .strict(),
  description: "A declared mandate was CLOSED. The row remains as history.",
});

export const INVESTOR_MANDATE_EVENTS: readonly EventDefinition[] = [
  InvestorMandateCreatedEvent,
  InvestorMandateUpdatedEvent,
  InvestorMandateActivatedEvent,
  InvestorMandateClosedEvent,
];

type Context = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly investorMandateId: string;
  readonly investorOrganisationId: string;
  readonly version: number;
};

function envelope<TData>(
  definition: EventDefinition,
  context: Context,
  data: TData,
): CapitalQEvent<TData> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `investor_mandate/${context.investorMandateId}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: context.tenantId,
    organisationId: context.organisationId,
    actor: { type: "HUMAN", id: context.actorUserId },
    correlationId: context.correlationId,
    aggregate: {
      type: "investor_mandate",
      id: context.investorMandateId,
      version: context.version,
    },
    data,
  };
}

export function investorMandateCreatedEvent(context: Context) {
  return envelope(InvestorMandateCreatedEvent, context, {
    investorMandateId: context.investorMandateId,
    investorOrganisationId: context.investorOrganisationId,
    version: context.version,
  });
}

export function investorMandateUpdatedEvent(
  context: Context & {
    readonly changedFields: readonly string[];
    readonly changeKinds: readonly MandateChangeKind[];
  },
) {
  return envelope(InvestorMandateUpdatedEvent, context, {
    investorMandateId: context.investorMandateId,
    investorOrganisationId: context.investorOrganisationId,
    version: context.version,
    changedFields: [...context.changedFields],
    changeKinds: [...context.changeKinds],
  });
}

export function investorMandateActivatedEvent(
  context: Context & { readonly effectiveFrom: string },
) {
  return envelope(InvestorMandateActivatedEvent, context, {
    investorMandateId: context.investorMandateId,
    investorOrganisationId: context.investorOrganisationId,
    version: context.version,
    effectiveFrom: context.effectiveFrom,
  });
}

export function investorMandateClosedEvent(
  context: Context & { readonly effectiveTo: string },
) {
  return envelope(InvestorMandateClosedEvent, context, {
    investorMandateId: context.investorMandateId,
    investorOrganisationId: context.investorOrganisationId,
    version: context.version,
    effectiveTo: context.effectiveTo,
  });
}
