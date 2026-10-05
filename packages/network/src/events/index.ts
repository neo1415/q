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
 * Network integration events. Distinct from network.relationship_events
 * (the history): the outbox carries a minimal announcement that a canonical
 * pair now exists, so later consumers can prepare, never the origin
 * details. No generic "event appended" announcement exists; later material
 * commands publish their own typed events (e.g. network.relationship.matched).
 */

export const NETWORK_EVENT_OWNER = "@capital-q/network" as const;
export const NETWORK_EVENT_PRODUCER = "capitalq://api/network" as const;

export const RelationshipCreatedEvent = defineEvent({
  name: "network.relationship.created",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/recommendations", "@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "A canonical Company ↔ Investor Organisation relationship was established. Carries identifiers only; origin, scope and payload stay in the private history.",
});

/**
 * An investor organisation expressed interest in a company (CQ-NET-010).
 * Identifiers only: who acted is on the envelope's actor, and the history
 * row carries the rest. Not a match: nothing consuming this may treat it
 * as bilateral.
 */
export const RelationshipInterestExpressedEvent = defineEvent({
  name: "network.relationship.interest_expressed",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      interestId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "An investor organisation expressed unilateral interest in a company on their canonical relationship. Not a match.",
});

/**
 * The company accepted an interest and the two sides are connected
 * (CQ-NET-011). Identifiers only; not an investment, not a state.
 */
export const RelationshipMatchedEvent = defineEvent({
  name: "network.relationship.matched",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      interestId: UuidSchema,
      matchId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "The company accepted an investor organisation's interest: both sides have agreed to connect on their canonical relationship.",
});

/** The company declined an interest (CQ-NET-011). Identifiers only; no reason exists to carry. */
export const RelationshipInterestDeclinedEvent = defineEvent({
  name: "network.relationship.interest_declined",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      interestId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
    })
    .strict(),
  description:
    "The company has not taken an investor organisation's interest forward.",
});

/**
 * A post-meeting outcome was recorded on a relationship (2026-10-02): a
 * pass, a pause, a resume, diligence or progress. Identifiers and the
 * outcome only -- never a pass's reason, which stays in the pass record
 * for whoever may read it. Consumers re-project the state and tell the
 * other side.
 */
export const RELATIONSHIP_OUTCOMES = [
  "PASSED",
  "PAUSED",
  "RESUMED",
  "DILIGENCE_STARTED",
  "PROGRESSED",
] as const;
export type RelationshipOutcome = (typeof RELATIONSHIP_OUTCOMES)[number];

export const RelationshipOutcomeRecordedEvent = defineEvent({
  name: "network.relationship.outcome_recorded",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q", "@capital-q/recommendations"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      companyId: UuidSchema,
      investorOrganisationId: UuidSchema,
      outcome: z.enum(RELATIONSHIP_OUTCOMES),
      side: z.enum(["INVESTOR", "COMPANY"]),
      /** The pass record, for a consumer allowed to read it; never its reason. */
      passId: UuidSchema.optional(),
    })
    .strict(),
  description:
    "A post-meeting outcome was recorded on a canonical relationship. Carries no reason and no note.",
});

/**
 * A message on the relationship's chat thread (QA run 8a1d57b9: a founder's
 * question sat unanswered for hours, and neither side was told of new
 * messages). Announced in the same transaction as the message and its
 * `message_sent` history row. Identifiers and the sending side only --
 * never the words. Activity, not a state move: talking is not interest.
 */
export const RelationshipMessageSentEvent = defineEvent({
  name: "network.relationship.message_sent",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q", "@capital-q/communication"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      conversationId: UuidSchema,
      messageId: UuidSchema,
      senderSide: z.enum(["INVESTOR", "COMPANY"]),
    })
    .strict(),
  description:
    "A person on one side (or Q for them) sent a message on the relationship's chat thread. Carries identifiers only.",
});

export function relationshipMessageSentEvent(input: {
  readonly tenantId: string;
  readonly senderUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly senderSide: "INVESTOR" | "COMPANY";
}): CapitalQEvent<z.infer<typeof RelationshipMessageSentEvent.dataSchema>> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipMessageSentEvent.name,
    source: RelationshipMessageSentEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipMessageSentEvent.version,
    tenantId: input.tenantId,
    actor: { type: "HUMAN", id: input.senderUserId },
    correlationId: input.correlationId,
    aggregate: { type: "chat_message", id: input.messageId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      senderSide: input.senderSide,
    },
  };
}

/**
 * A commitment moved a step (2026-10-04): one side confirmed the amount
 * (asking the other), both sides confirmed it, the investor's side marked
 * it sent, or the company's side confirmed receipt. Identifiers, the step
 * and the acting side only -- never the amount or a reference. Consumers
 * tell the other side and re-project the relationship (INVESTED on
 * receipt).
 */
export const COMMITMENT_STEPS = [
  "AMOUNT_STATED",
  "AMOUNT_CONFIRMED",
  "TRANSFER_SENT",
  "RECEIVED",
] as const;
export type CommitmentStep = (typeof COMMITMENT_STEPS)[number];

export const RelationshipCommitmentChangedEvent = defineEvent({
  name: "network.relationship.commitment_changed",
  version: 1,
  owner: NETWORK_EVENT_OWNER,
  producer: NETWORK_EVENT_PRODUCER,
  consumers: ["@capital-q/q", "@capital-q/communication"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      relationshipId: UuidSchema,
      commitmentId: UuidSchema,
      step: z.enum(COMMITMENT_STEPS),
      side: z.enum(["INVESTOR", "COMPANY"]),
    })
    .strict(),
  description:
    "A commitment on a canonical relationship moved a step. Carries identifiers, the step and the acting side; never the amount.",
});

export function relationshipCommitmentChangedEvent(input: {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly commitmentId: string;
  readonly step: CommitmentStep;
  readonly side: "INVESTOR" | "COMPANY";
}): CapitalQEvent<
  z.infer<typeof RelationshipCommitmentChangedEvent.dataSchema>
> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipCommitmentChangedEvent.name,
    source: RelationshipCommitmentChangedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipCommitmentChangedEvent.version,
    tenantId: input.tenantId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "commitment", id: input.commitmentId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      commitmentId: input.commitmentId,
      step: input.step,
      side: input.side,
    },
  };
}

export const NETWORK_EVENTS: readonly EventDefinition[] = [
  RelationshipCreatedEvent,
  RelationshipInterestExpressedEvent,
  RelationshipMatchedEvent,
  RelationshipInterestDeclinedEvent,
  RelationshipOutcomeRecordedEvent,
  RelationshipMessageSentEvent,
  RelationshipCommitmentChangedEvent,
];

export function relationshipOutcomeRecordedEvent(input: {
  readonly tenantId: string;
  readonly organisationId: string | undefined;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
  readonly outcome: RelationshipOutcome;
  readonly side: "INVESTOR" | "COMPANY";
  readonly passId?: string | undefined;
}): CapitalQEvent<z.infer<typeof RelationshipOutcomeRecordedEvent.dataSchema>> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipOutcomeRecordedEvent.name,
    source: RelationshipOutcomeRecordedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipOutcomeRecordedEvent.version,
    tenantId: input.tenantId,
    ...(input.organisationId === undefined
      ? {}
      : { organisationId: input.organisationId }),
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "relationship", id: input.relationshipId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      companyId: input.companyId,
      investorOrganisationId: input.investorOrganisationId,
      outcome: input.outcome,
      side: input.side,
      ...(input.passId === undefined ? {} : { passId: input.passId }),
    },
  };
}

/** One of the company's answers, as its outbox announcement. */
export function interestAnsweredEvent(input: {
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly interestId: string;
  readonly matchId: string | null;
  readonly companyId: string;
  readonly investorOrganisationId: string;
}): CapitalQEvent<Readonly<Record<string, string>>> {
  const definition =
    input.decision === "ACCEPTED"
      ? RelationshipMatchedEvent
      : RelationshipInterestDeclinedEvent;
  const identifiers = {
    relationshipId: input.relationshipId,
    interestId: input.interestId,
    companyId: input.companyId,
    investorOrganisationId: input.investorOrganisationId,
  };
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "interest", id: input.interestId, version: 2 },
    data:
      input.decision === "ACCEPTED" && input.matchId !== null
        ? { ...identifiers, matchId: input.matchId }
        : identifiers,
  };
}

export function relationshipInterestExpressedEvent(input: {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly interestId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
}): CapitalQEvent<
  z.infer<typeof RelationshipInterestExpressedEvent.dataSchema>
> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipInterestExpressedEvent.name,
    source: RelationshipInterestExpressedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipInterestExpressedEvent.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "interest", id: input.interestId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      interestId: input.interestId,
      companyId: input.companyId,
      investorOrganisationId: input.investorOrganisationId,
    },
  };
}

export function relationshipCreatedEvent(input: {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly relationshipId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
}): CapitalQEvent<z.infer<typeof RelationshipCreatedEvent.dataSchema>> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: RelationshipCreatedEvent.name,
    source: RelationshipCreatedEvent.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `relationship/${input.relationshipId}`,
    dataContentType: "application/json",
    eventVersion: RelationshipCreatedEvent.version,
    tenantId: input.tenantId,
    organisationId: input.organisationId,
    actor: { type: "HUMAN", id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "relationship", id: input.relationshipId, version: 1 },
    data: {
      relationshipId: input.relationshipId,
      companyId: input.companyId,
      investorOrganisationId: input.investorOrganisationId,
    },
  };
}
