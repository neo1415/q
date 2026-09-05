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
import type { ActorContext } from "@capital-q/security";

import {
  ClaimChangeKindSchema,
  ClaimEvidenceRelationshipSchema,
  DocumentTypeSchema,
  EvidenceSourceTypeSchema,
  EvidenceSubjectTypeSchema,
  type ClaimChangeKind,
} from "../contracts/index.js";

/**
 * Evidence events. All CONFIDENTIAL: a consumer learns that a source,
 * document, version, claim or evidence item exists and how it changed,
 * never what it says. Payloads carry identifiers, subject references,
 * version and revision numbers, coded types and change categories. No
 * statement, summary, title, filename, storage key or source URL is ever
 * emitted.
 */

export const EVIDENCE_EVENT_OWNER = "@capital-q/evidence" as const;
export const EVIDENCE_EVENT_PRODUCER = "capitalq://api/evidence" as const;

const CONSUMERS = [
  "@capital-q/q",
  "@capital-q/knowledge",
  "@capital-q/workers",
];

const subject = z.object({
  subjectType: EvidenceSubjectTypeSchema,
  subjectId: UuidSchema,
});

export const EvidenceSourceRegisteredEvent = defineEvent({
  name: "evidence.source.registered",
  version: 1,
  owner: EVIDENCE_EVENT_OWNER,
  producer: EVIDENCE_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      sourceId: UuidSchema,
      sourceType: EvidenceSourceTypeSchema,
      ...subject.shape,
    })
    .strict(),
  description:
    "A provenance source was registered for a subject. Provenance only; nothing about the source is believed or fetched.",
});

export const DocumentCreatedEvent = defineEvent({
  name: "evidence.document.created",
  version: 1,
  owner: EVIDENCE_EVENT_OWNER,
  producer: EVIDENCE_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      documentId: UuidSchema,
      ownerOrganisationId: UuidSchema,
      companyId: UuidSchema.nullable(),
      documentType: DocumentTypeSchema,
    })
    .strict(),
  description:
    "A logical document identity was created. No file exists yet unless a version event follows.",
});

export const DocumentVersionCreatedEvent = defineEvent({
  name: "evidence.document.version_created",
  version: 1,
  owner: EVIDENCE_EVENT_OWNER,
  producer: EVIDENCE_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      documentId: UuidSchema,
      documentVersionId: UuidSchema,
      versionNumber: z.number().int().min(1),
      supersedesVersionId: UuidSchema.nullable(),
    })
    .strict(),
  description:
    "An immutable file version was registered and became the document's current version. Carries no storage identity.",
});

export const ClaimChangedEvent = defineEvent({
  name: "evidence.claim.changed",
  version: 1,
  owner: EVIDENCE_EVENT_OWNER,
  producer: EVIDENCE_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      claimId: UuidSchema,
      ...subject.shape,
      changeKind: ClaimChangeKindSchema,
      revisionNumber: z.number().int().min(1),
      relationship: ClaimEvidenceRelationshipSchema.optional(),
      evidenceItemId: UuidSchema.optional(),
    })
    .strict(),
  description:
    "A claim was created, revised, or linked to evidence. Never the statement, value or truth state.",
});

export const EvidenceItemCreatedEvent = defineEvent({
  name: "evidence.evidence_item.created",
  version: 1,
  owner: EVIDENCE_EVENT_OWNER,
  producer: EVIDENCE_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      evidenceItemId: UuidSchema,
      sourceId: UuidSchema,
      ...subject.shape,
    })
    .strict(),
  description:
    "An evidence item was identified inside a source. Never the summary, value or locator.",
});

export const EVIDENCE_EVENTS: readonly EventDefinition[] = [
  EvidenceSourceRegisteredEvent,
  DocumentCreatedEvent,
  DocumentVersionCreatedEvent,
  ClaimChangedEvent,
  EvidenceItemCreatedEvent,
];

type Context = {
  readonly actor: ActorContext;
  readonly organisationId: string;
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
    tenantId: context.actor.tenantId,
    organisationId: context.organisationId,
    actor: { type: context.actor.actorType, id: context.actor.userId },
    correlationId: context.correlationId,
    aggregate,
    data,
  };
}

export function evidenceSourceRegisteredEvent(
  context: Context,
  data: z.infer<typeof EvidenceSourceRegisteredEvent.dataSchema>,
) {
  return envelope(
    EvidenceSourceRegisteredEvent,
    context,
    { type: "evidence_source", id: data.sourceId, version: 1 },
    data,
  );
}

export function documentCreatedEvent(
  context: Context,
  data: z.infer<typeof DocumentCreatedEvent.dataSchema>,
) {
  return envelope(
    DocumentCreatedEvent,
    context,
    { type: "document", id: data.documentId, version: 1 },
    data,
  );
}

export function documentVersionCreatedEvent(
  context: Context,
  documentVersion: number,
  data: z.infer<typeof DocumentVersionCreatedEvent.dataSchema>,
) {
  return envelope(
    DocumentVersionCreatedEvent,
    context,
    { type: "document", id: data.documentId, version: documentVersion },
    data,
  );
}

export function claimChangedEvent(
  context: Context,
  data: z.infer<typeof ClaimChangedEvent.dataSchema> & {
    readonly changeKind: ClaimChangeKind;
  },
) {
  return envelope(
    ClaimChangedEvent,
    context,
    { type: "claim", id: data.claimId, version: data.revisionNumber },
    data,
  );
}

export function evidenceItemCreatedEvent(
  context: Context,
  data: z.infer<typeof EvidenceItemCreatedEvent.dataSchema>,
) {
  return envelope(
    EvidenceItemCreatedEvent,
    context,
    { type: "evidence_item", id: data.evidenceItemId, version: 1 },
    data,
  );
}
