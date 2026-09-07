import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  QActionClassSchema,
  QActionStatusSchema,
  QActionTypeSchema,
  QActionVersionSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

/**
 * Canonical Q action integration events (doc 22 §94-§95 naming; CQ-Q-008
 * §80-§81). Owner: the Approval Engine. CONFIDENTIAL: the existence of a
 * prepared consequential action is company- or investor-private.
 * REPLAY_SAFE: consumers re-read the action under their own authority.
 *
 * Payloads carry identifiers, type, version, class and status only —
 * never the proposed payload, the targets' content, the approver's
 * reasoning or the fingerprint. These are domain events: distinct from the
 * run's `q.approval.required` stream event and from the material-action
 * audit record, which serve different purposes and are never collapsed.
 */

export const Q_ACTION_EVENT_OWNER = "@capital-q/q-actions" as const;
export const Q_ACTION_EVENT_PRODUCER = "capitalq://q-api/q/actions" as const;

const CONSUMERS = ["@capital-q/q", "@capital-q/intelligence"];

const base = {
  actionId: UuidSchema,
  runId: UuidSchema,
  actionType: QActionTypeSchema,
  actionVersion: QActionVersionSchema,
  riskClass: QActionClassSchema,
  actionStatus: QActionStatusSchema,
};

export const QActionPreparedEvent = defineEvent({
  name: "q.action.prepared",
  version: 1,
  owner: Q_ACTION_EVENT_OWNER,
  producer: Q_ACTION_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({ ...base, approvalId: UuidSchema }).strict(),
  description:
    "Q proposed a consequential action and an approval was requested from a person. Nothing has executed.",
});

export const QActionApprovedEvent = defineEvent({
  name: "q.action.approved",
  version: 1,
  owner: Q_ACTION_EVENT_OWNER,
  producer: Q_ACTION_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({ ...base, approvalId: UuidSchema }).strict(),
  description:
    "A person approved the exact proposed action. Approval is not execution; nothing has executed yet.",
});

export const QActionRejectedEvent = defineEvent({
  name: "q.action.rejected",
  version: 1,
  owner: Q_ACTION_EVENT_OWNER,
  producer: Q_ACTION_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({ ...base, approvalId: UuidSchema }).strict(),
  description:
    "A person declined the proposed action. No side effect occurred.",
});

export const QActionExecutedEvent = defineEvent({
  name: "q.action.executed",
  version: 1,
  owner: Q_ACTION_EVENT_OWNER,
  producer: Q_ACTION_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({ ...base, approvalId: UuidSchema }).strict(),
  description:
    "The deterministic executor completed the approved action. This event, not a model statement, is what success means.",
});

export const QActionExecutionFailedEvent = defineEvent({
  name: "q.action.execution_failed",
  version: 1,
  owner: Q_ACTION_EVENT_OWNER,
  producer: Q_ACTION_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      ...base,
      approvalId: UuidSchema,
      failureCode: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .max(64),
      retryPermitted: z.boolean(),
    })
    .strict(),
  description:
    "Execution ended without success (definite failure, or an outcome the executor could not determine). Not a retry instruction.",
});

/** Everything the Approval Engine publishes. */
export const Q_ACTION_EVENTS: readonly EventDefinition[] = [
  QActionPreparedEvent,
  QActionApprovedEvent,
  QActionRejectedEvent,
  QActionExecutedEvent,
  QActionExecutionFailedEvent,
];

export type QActionEventContext = {
  readonly tenantId: string;
  readonly organisationId: string | null;
  /** Who the event is attributed to: the deciding person, or Q for proposal/execution. */
  readonly actor: { readonly type: "HUMAN" | "Q"; readonly id: string };
  readonly correlationId: CorrelationId;
  readonly actionId: string;
  readonly actionVersion: number;
};

export function qActionEvent<TData>(
  definition: EventDefinition,
  context: QActionEventContext,
  data: TData,
): CapitalQEvent<TData> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `q_action/${context.actionId}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: context.tenantId,
    ...(context.organisationId === null
      ? {}
      : { organisationId: context.organisationId }),
    actor: { type: context.actor.type, id: context.actor.id },
    correlationId: context.correlationId,
    aggregate: {
      type: "q_action",
      id: context.actionId,
      version: context.actionVersion,
    },
    data,
  };
}
