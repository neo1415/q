import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CapitalObjectiveStatusSchema,
  defineEvent,
  EventIdSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

import {
  CapitalChangeKindSchema,
  type CapitalChangeKind,
} from "../domain/history.js";

/**
 * Canonical Capital Objective integration events. Owner: this bounded
 * context. CONFIDENTIAL: a raise is company-private until disclosure says
 * otherwise. REPLAY_SAFE: consumers re-read the objective under their own
 * authority. Payloads carry identifiers, versions, change categories and
 * closure reasons only -- never the target amount, the timeline or the
 * use-of-funds text. Those live in the canonical row and its private
 * history, reachable only through authorised application paths.
 */

export const CAPITAL_EVENT_OWNER = "@capital-q/capital" as const;
export const CAPITAL_EVENT_PRODUCER = "capitalq://api/core/capital" as const;

const CONSUMERS = [
  "@capital-q/onboarding",
  "@capital-q/intelligence",
  "@capital-q/recommendations",
  "@capital-q/q",
];
const version = z.number().int().min(1);

export const CapitalObjectiveCreatedEvent = defineEvent({
  name: "core.capital_objective.created",
  version: 1,
  owner: CAPITAL_EVENT_OWNER,
  producer: CAPITAL_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      capitalObjectiveId: UuidSchema,
      companyId: UuidSchema,
      version,
    })
    .strict(),
  description:
    "A company's canonical capital objective became ACTIVE. Carries no target.",
});

export const CapitalObjectiveUpdatedEvent = defineEvent({
  name: "core.capital_objective.updated",
  version: 1,
  owner: CAPITAL_EVENT_OWNER,
  producer: CAPITAL_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      capitalObjectiveId: UuidSchema,
      companyId: UuidSchema,
      version,
      changedFields: z.array(z.string().min(1).max(64)).min(1).max(8),
      changeKinds: z.array(CapitalChangeKindSchema).min(1).max(8),
    })
    .strict(),
  description:
    "The active capital objective was recalibrated. changeKinds names categories so consumers can decide whether to reassess, without any values.",
});

export const CapitalObjectiveClosedEvent = defineEvent({
  name: "core.capital_objective.closed",
  version: 1,
  owner: CAPITAL_EVENT_OWNER,
  producer: CAPITAL_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      capitalObjectiveId: UuidSchema,
      companyId: UuidSchema,
      version,
      closureReason: CapitalObjectiveStatusSchema.exclude(["ACTIVE"]),
      replacementCapitalObjectiveId: UuidSchema.optional(),
    })
    .strict(),
  description:
    "A capital objective ended (ACHIEVED, CLOSED_BY_FOUNDER, DISCONTINUED or REPLACED with the replacement's id). Not a failure signal.",
});

/** Everything the Capital bounded context publishes. */
export const CAPITAL_EVENTS: readonly EventDefinition[] = [
  CapitalObjectiveCreatedEvent,
  CapitalObjectiveUpdatedEvent,
  CapitalObjectiveClosedEvent,
];

type Context = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly capitalObjectiveId: string;
  readonly companyId: string;
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
    subject: `capital_objective/${context.capitalObjectiveId}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: context.tenantId,
    organisationId: context.organisationId,
    actor: { type: "HUMAN", id: context.actorUserId },
    correlationId: context.correlationId,
    aggregate: {
      type: "capital_objective",
      id: context.capitalObjectiveId,
      version: context.version,
    },
    data,
  };
}

export function capitalObjectiveCreatedEvent(context: Context) {
  return envelope(CapitalObjectiveCreatedEvent, context, {
    capitalObjectiveId: context.capitalObjectiveId,
    companyId: context.companyId,
    version: context.version,
  });
}

export function capitalObjectiveUpdatedEvent(
  context: Context & {
    readonly changedFields: readonly string[];
    readonly changeKinds: readonly CapitalChangeKind[];
  },
) {
  return envelope(CapitalObjectiveUpdatedEvent, context, {
    capitalObjectiveId: context.capitalObjectiveId,
    companyId: context.companyId,
    version: context.version,
    changedFields: [...context.changedFields],
    changeKinds: [...context.changeKinds],
  });
}

export function capitalObjectiveClosedEvent(
  context: Context & {
    readonly closureReason:
      "ACHIEVED" | "CLOSED_BY_FOUNDER" | "DISCONTINUED" | "REPLACED";
    readonly replacementCapitalObjectiveId?: string | undefined;
  },
) {
  return envelope(CapitalObjectiveClosedEvent, context, {
    capitalObjectiveId: context.capitalObjectiveId,
    companyId: context.companyId,
    version: context.version,
    closureReason: context.closureReason,
    ...(context.replacementCapitalObjectiveId === undefined
      ? {}
      : {
          replacementCapitalObjectiveId: context.replacementCapitalObjectiveId,
        }),
  });
}
