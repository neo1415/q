import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  InvestorPortfolioSourceSchema,
  InvestorTypeSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

/**
 * Canonical Investor domain events. Owner: this bounded context. INTERNAL:
 * an investor organisation existing in a workspace is not network or public
 * information until a disclosure rule says so. REPLAY_SAFE: consumers
 * rebuild derived state and re-read under their own authority. Payloads
 * carry identifiers, the investor type, versions and changed field names
 * only -- never profile text.
 */

import { INVESTOR_EVENT_OWNER, INVESTOR_EVENT_PRODUCER } from "./shared.js";
import { INVESTOR_MANDATE_EVENTS as MANDATE_EVENTS } from "./mandate.js";

export { INVESTOR_EVENT_OWNER, INVESTOR_EVENT_PRODUCER } from "./shared.js";
export {
  INVESTOR_MANDATE_EVENTS,
  investorMandateActivatedEvent,
  investorMandateClosedEvent,
  investorMandateCreatedEvent,
  investorMandateUpdatedEvent,
  InvestorMandateActivatedEvent,
  InvestorMandateClosedEvent,
  InvestorMandateCreatedEvent,
  InvestorMandateUpdatedEvent,
  MANDATE_CHANGE_KINDS,
  MandateChangeKindSchema,
  type MandateChangeKind,
} from "./mandate.js";

const changedFields = z.array(z.string().min(1).max(64)).min(1).max(16);

export const InvestorOrganisationCreatedEvent = defineEvent({
  name: "core.investor_organisation.created",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/discovery", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorOrganisationId: UuidSchema,
      organisationId: UuidSchema,
      investorType: InvestorTypeSchema,
      version: z.number().int().min(1),
    })
    .strict(),
  description:
    "The canonical investor organisation for an organisation was established.",
});

export const InvestorOrganisationUpdatedEvent = defineEvent({
  name: "core.investor_organisation.updated",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/discovery", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorOrganisationId: UuidSchema,
      version: z.number().int().min(1),
      changedFields,
    })
    .strict(),
  description:
    "The investor organisation profile or deployment state changed; consumers re-read the fields they need.",
});

export const InvestorRepresentativeCreatedEvent = defineEvent({
  name: "core.investor_representative.created",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorRepresentativeId: UuidSchema,
      investorOrganisationId: UuidSchema,
      userId: UuidSchema,
      membershipId: UuidSchema,
    })
    .strict(),
  description:
    "A person began representing an investor organisation in the capacity of an organisation membership. No authority is implied.",
});

export const InvestorRepresentativeUpdatedEvent = defineEvent({
  name: "core.investor_representative.updated",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      investorRepresentativeId: UuidSchema,
      investorOrganisationId: UuidSchema,
      version: z.number().int().min(1),
      changedFields,
    })
    .strict(),
  description:
    "A person's current representation of an investor organisation changed (presentation fields only).",
});

export const InvestorPortfolioReferenceAddedEvent = defineEvent({
  name: "core.investor_portfolio_reference.added",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      portfolioReferenceId: UuidSchema,
      investorOrganisationId: UuidSchema,
      source: InvestorPortfolioSourceSchema,
    })
    .strict(),
  description:
    "The investor named a representative portfolio company (ADR 0007). Identifiers and provenance only; the name stays investor-private.",
});

export const InvestorPortfolioReferenceRemovedEvent = defineEvent({
  name: "core.investor_portfolio_reference.removed",
  version: 1,
  owner: INVESTOR_EVENT_OWNER,
  producer: INVESTOR_EVENT_PRODUCER,
  consumers: ["@capital-q/onboarding", "@capital-q/q"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      portfolioReferenceId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description: "A portfolio reference was removed; the row is kept as history.",
});

/** Everything the Investor bounded context publishes. */
export const INVESTOR_EVENTS: readonly EventDefinition[] = [
  InvestorOrganisationCreatedEvent,
  InvestorOrganisationUpdatedEvent,
  InvestorRepresentativeCreatedEvent,
  InvestorRepresentativeUpdatedEvent,
  InvestorPortfolioReferenceAddedEvent,
  InvestorPortfolioReferenceRemovedEvent,
  ...MANDATE_EVENTS,
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

export function investorOrganisationCreatedEvent(
  input: Context & {
    readonly investorOrganisationId: string;
    readonly investorType: z.infer<typeof InvestorTypeSchema>;
    readonly version: number;
  },
) {
  return envelope(
    InvestorOrganisationCreatedEvent,
    input,
    {
      type: "investor_organisation",
      id: input.investorOrganisationId,
      version: input.version,
    },
    {
      investorOrganisationId: input.investorOrganisationId,
      organisationId: input.organisationId,
      investorType: input.investorType,
      version: input.version,
    },
  );
}

export function investorOrganisationUpdatedEvent(
  input: Context & {
    readonly investorOrganisationId: string;
    readonly version: number;
    readonly changedFields: readonly string[];
  },
) {
  return envelope(
    InvestorOrganisationUpdatedEvent,
    input,
    {
      type: "investor_organisation",
      id: input.investorOrganisationId,
      version: input.version,
    },
    {
      investorOrganisationId: input.investorOrganisationId,
      version: input.version,
      changedFields: [...input.changedFields],
    },
  );
}

export function investorRepresentativeCreatedEvent(
  input: Context & {
    readonly investorRepresentativeId: string;
    readonly investorOrganisationId: string;
    readonly userId: string;
    readonly membershipId: string;
    readonly version: number;
  },
) {
  return envelope(
    InvestorRepresentativeCreatedEvent,
    input,
    {
      type: "investor_representative",
      id: input.investorRepresentativeId,
      version: input.version,
    },
    {
      investorRepresentativeId: input.investorRepresentativeId,
      investorOrganisationId: input.investorOrganisationId,
      userId: input.userId,
      membershipId: input.membershipId,
    },
  );
}

export function investorRepresentativeUpdatedEvent(
  input: Context & {
    readonly investorRepresentativeId: string;
    readonly investorOrganisationId: string;
    readonly version: number;
    readonly changedFields: readonly string[];
  },
) {
  return envelope(
    InvestorRepresentativeUpdatedEvent,
    input,
    {
      type: "investor_representative",
      id: input.investorRepresentativeId,
      version: input.version,
    },
    {
      investorRepresentativeId: input.investorRepresentativeId,
      investorOrganisationId: input.investorOrganisationId,
      version: input.version,
      changedFields: [...input.changedFields],
    },
  );
}

export function investorPortfolioReferenceAddedEvent(
  input: Context & {
    readonly investorOrganisationId: string;
    readonly portfolioReferenceId: string;
    readonly source: z.infer<typeof InvestorPortfolioSourceSchema>;
  },
) {
  return envelope(
    InvestorPortfolioReferenceAddedEvent,
    input,
    {
      type: "investor_portfolio_reference",
      id: input.portfolioReferenceId,
      version: 1,
    },
    {
      portfolioReferenceId: input.portfolioReferenceId,
      investorOrganisationId: input.investorOrganisationId,
      source: input.source,
    },
  );
}

export function investorPortfolioReferenceRemovedEvent(
  input: Context & {
    readonly investorOrganisationId: string;
    readonly portfolioReferenceId: string;
  },
) {
  return envelope(
    InvestorPortfolioReferenceRemovedEvent,
    input,
    {
      type: "investor_portfolio_reference",
      id: input.portfolioReferenceId,
      version: 2,
    },
    {
      portfolioReferenceId: input.portfolioReferenceId,
      investorOrganisationId: input.investorOrganisationId,
    },
  );
}
