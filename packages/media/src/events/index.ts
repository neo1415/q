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
  MediaOwnerTypeSchema,
  MediaPurposeSchema,
  MediaStatusSchema,
} from "../contracts/index.js";

/**
 * Media domain events.
 *
 * A consumer learns that a company's pitch media was created, replaced or
 * deleted, and where it stands in its lifecycle. It never learns the
 * provider's identifier, an upload target, a playback token, a thumbnail
 * reference or a transcript: those are integration and content material,
 * and an event is the wrong place for both.
 *
 * There is deliberately no `ready` event. Nothing in this packet can
 * truthfully make an asset READY, and an event no producer can emit is a
 * promise to consumers that the system cannot keep. `CQ-MEDIA-012` adds it
 * when verified provider webhooks can genuinely say so.
 */

export const MEDIA_EVENT_OWNER = "@capital-q/media" as const;
export const MEDIA_EVENT_PRODUCER = "capitalq://api/media" as const;

const CONSUMERS = ["@capital-q/q", "@capital-q/workers"];

const ownership = {
  mediaAssetId: UuidSchema,
  ownerType: MediaOwnerTypeSchema,
  ownerId: UuidSchema,
  purpose: MediaPurposeSchema,
};

export const MediaAssetCreatedEvent = defineEvent({
  name: "media.asset.created",
  version: 1,
  owner: MEDIA_EVENT_OWNER,
  producer: MEDIA_EVENT_PRODUCER,
  consumers: CONSUMERS,
  // A company having pitch media is workspace information, not network or
  // public information, whatever Discover may later show under its own
  // permissions.
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({ ...ownership, status: MediaStatusSchema }).strict(),
  description:
    "A logical media asset was created for an owning resource. Nothing has been uploaded and no provider asset exists yet.",
});

export const MediaAssetReplacedEvent = defineEvent({
  name: "media.asset.replaced",
  version: 1,
  owner: MEDIA_EVENT_OWNER,
  producer: MEDIA_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      ...ownership,
      status: MediaStatusSchema,
      /** The asset this one supersedes. History, never overwritten. */
      replacesMediaAssetId: UuidSchema,
    })
    .strict(),
  description:
    "A new media asset replaced the owner's current one. The predecessor is superseded and remains historically interpretable.",
});

export const MediaAssetDeletedEvent = defineEvent({
  name: "media.asset.deleted",
  version: 1,
  owner: MEDIA_EVENT_OWNER,
  producer: MEDIA_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({ ...ownership }).strict(),
  description:
    "A media asset was deleted. Application visibility ends; provider deletion and any derived material are handled under their own policies.",
});

export const MEDIA_EVENTS: readonly EventDefinition[] = [
  MediaAssetCreatedEvent,
  MediaAssetReplacedEvent,
  MediaAssetDeletedEvent,
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

export function mediaAssetCreatedEvent(
  context: Context,
  data: z.infer<typeof MediaAssetCreatedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetCreatedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: 1 },
    data,
  );
}

export function mediaAssetReplacedEvent(
  context: Context,
  data: z.infer<typeof MediaAssetReplacedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetReplacedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: 1 },
    data,
  );
}

export function mediaAssetDeletedEvent(
  context: Context,
  assetVersion: number,
  data: z.infer<typeof MediaAssetDeletedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetDeletedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: assetVersion },
    data,
  );
}
