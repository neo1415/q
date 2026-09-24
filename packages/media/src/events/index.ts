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
  ModerationStatusSchema,
  PlaybackPolicySchema,
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
 * There is deliberately no separate `ready` event. Reaching READY is one
 * `media.asset.status_changed` step, produced by the founder's status poll
 * (CQ-MEDIA-011) or a verified provider webhook (CQ-MEDIA-012) — whichever
 * hears first — and never twice, because the lifecycle admits the step
 * once.
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

/**
 * The lifecycle moved (CQ-MEDIA-011). One event for every legal step,
 * carrying both ends, rather than a `ready` and a `failed` and a
 * `processing` that each consumer would have to reassemble into a
 * sequence. A READY here means the provider said so and Capital Q's
 * lifecycle accepted it; it still does not mean discoverable or approved.
 */
export const MediaAssetStatusChangedEvent = defineEvent({
  name: "media.asset.status_changed",
  version: 1,
  owner: MEDIA_EVENT_OWNER,
  producer: MEDIA_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      ...ownership,
      previousStatus: MediaStatusSchema,
      status: MediaStatusSchema,
    })
    .strict(),
  description:
    "A media asset moved one step along Capital Q's lifecycle, as observed from the provider. Carries no provider identifier, upload target or playback material.",
});

/**
 * The founder's commercial decision (CQ-MEDIA-013): whether investors may
 * play the pitch. A separate axis from the lifecycle and from moderation,
 * and a separate event, so a consumer never has to infer a decision from
 * a status.
 */
export const MediaAssetPlaybackPolicyChangedEvent = defineEvent({
  name: "media.asset.playback_policy_changed",
  version: 1,
  owner: MEDIA_EVENT_OWNER,
  producer: MEDIA_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      ...ownership,
      previousPlaybackPolicy: PlaybackPolicySchema,
      playbackPolicy: PlaybackPolicySchema,
    })
    .strict(),
  description:
    "The owner changed who may be granted playback of a media asset. Discoverability follows the existing rules; nothing here publishes anything by itself.",
});

/**
 * Capital Q's integrity decision (CQ-MEDIA-013): what review concluded and
 * who concluded it. Provenance travels with the decision so a consumer
 * can tell a rule's verdict from a person's.
 */
export const MediaAssetModeratedEvent = defineEvent({
  name: "media.asset.moderated",
  version: 1,
  owner: MEDIA_EVENT_OWNER,
  producer: MEDIA_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      ...ownership,
      previousModerationStatus: ModerationStatusSchema,
      moderationStatus: ModerationStatusSchema,
      /** AUTOMATED_RULE_V1 today; a reviewer's provenance when one exists. */
      provenance: z.string().min(1).max(64),
      ruleVersion: z.string().min(1).max(64).nullable(),
      /** Why a rule held rather than allowed; empty when it allowed. */
      holdReasons: z.array(z.string().max(64)).max(16),
    })
    .strict(),
  description:
    "A moderation decision was recorded for a media asset, with its provenance. Automation only ever allows or holds for a person; it never blocks.",
});

export const MEDIA_EVENTS: readonly EventDefinition[] = [
  MediaAssetCreatedEvent,
  MediaAssetReplacedEvent,
  MediaAssetDeletedEvent,
  MediaAssetStatusChangedEvent,
  MediaAssetPlaybackPolicyChangedEvent,
  MediaAssetModeratedEvent,
];

/** A person acted: their tenant, their organisation, their correlation. */
export type EventContext = {
  readonly actor: ActorContext;
  readonly organisationId: string;
  readonly correlationId: CorrelationId;
};

/**
 * The platform acting on its own authority (CQ-MEDIA-013): a rule ran, no
 * person pressed anything. Attributable without an actor id, exactly as
 * the envelope allows for SYSTEM.
 */
export type SystemContext = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly correlationId: CorrelationId;
};

function envelope<TData>(
  definition: EventDefinition,
  context: EventContext | SystemContext,
  aggregate: {
    readonly type: string;
    readonly id: string;
    readonly version: number;
  },
  data: TData,
): CapitalQEvent<TData> {
  const attribution: {
    readonly tenantId: string;
    readonly actor: {
      readonly type: "SYSTEM" | ActorContext["actorType"];
      readonly id?: string;
    };
  } =
    "actor" in context
      ? {
          tenantId: context.actor.tenantId,
          actor: { type: context.actor.actorType, id: context.actor.userId },
        }
      : { tenantId: context.tenantId, actor: { type: "SYSTEM" } };
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `${aggregate.type}/${aggregate.id}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    tenantId: attribution.tenantId,
    organisationId: context.organisationId,
    actor: attribution.actor,
    correlationId: context.correlationId,
    aggregate,
    data,
  };
}

export function mediaAssetPlaybackPolicyChangedEvent(
  context: EventContext,
  assetVersion: number,
  data: z.infer<typeof MediaAssetPlaybackPolicyChangedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetPlaybackPolicyChangedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: assetVersion },
    data,
  );
}

export function mediaAssetModeratedEvent(
  context: EventContext | SystemContext,
  assetVersion: number,
  data: z.infer<typeof MediaAssetModeratedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetModeratedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: assetVersion },
    data,
  );
}

export function mediaAssetCreatedEvent(
  context: EventContext,
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
  context: EventContext,
  data: z.infer<typeof MediaAssetReplacedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetReplacedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: 1 },
    data,
  );
}

export function mediaAssetStatusChangedEvent(
  context: EventContext | SystemContext,
  assetVersion: number,
  data: z.infer<typeof MediaAssetStatusChangedEvent.dataSchema>,
) {
  return envelope(
    MediaAssetStatusChangedEvent,
    context,
    { type: "media_asset", id: data.mediaAssetId, version: assetVersion },
    data,
  );
}

export function mediaAssetDeletedEvent(
  context: EventContext,
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
