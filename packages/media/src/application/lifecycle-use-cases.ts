import { z } from "zod";

import type { TenantId } from "@capital-q/security";

import {
  CaptionStateSchema,
  MediaAssetIdSchema,
  MediaProviderSchema,
  MediaStatusSchema,
  MediaTechnicalMetadataSchema,
  ModerationStatusSchema,
  PlaybackPolicySchema,
  ProviderAssetIdSchema,
  TranscriptStateSchema,
  type MediaAsset,
} from "../contracts/index.js";
import {
  MediaAssetConflictError,
  MediaAssetNotFoundError,
  MediaRuleError,
  MediaTransitionError,
} from "../domain/errors.js";
import { canTransition } from "../domain/lifecycle.js";
import type { MediaServiceDependencies } from "./dependencies.js";

/**
 * Trusted server operations on a media asset's lifecycle and provider
 * metadata.
 *
 * No browser reaches these. A client cannot say an asset is READY, cannot
 * name the provider or its identifier, cannot set a duration and cannot
 * declare its own content moderated — every one of those is either a
 * provider fact or a Capital Q decision, and accepting a client's word for
 * them would make the record meaningless.
 *
 * `CQ-MEDIA-010` and `CQ-MEDIA-012` drive these from an adapter and verified
 * webhooks. Until then nothing in production calls them, and a synthetic
 * provider in tests is the only thing that moves an asset past CREATED.
 */

export type LifecycleDependencies = Pick<
  MediaServiceDependencies,
  "sql" | "transactions" | "repositories"
>;

export const TransitionMediaStatusInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    mediaAssetId: MediaAssetIdSchema,
    status: MediaStatusSchema,
    /** The version the caller read. A stale writer loses, loudly. */
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type TransitionMediaStatusInput = z.infer<
  typeof TransitionMediaStatusInputSchema
>;

/**
 * Moves one asset along the lifecycle, or refuses.
 *
 * The refusal is the point. A late provider event carrying PROCESSING for
 * an asset that is already READY, or anything at all for one that is
 * DELETED, is not applied — the lifecycle says the move is illegal and the
 * row is left exactly as it was.
 */
export function createTransitionMediaStatus(
  dependencies: LifecycleDependencies,
) {
  const { repositories, transactions } = dependencies;
  return async (input: TransitionMediaStatusInput): Promise<MediaAsset> => {
    const parsed = TransitionMediaStatusInputSchema.parse(input);
    const tenantId = parsed.tenantId as TenantId;

    return transactions.run(async (tx) => {
      const asset = await repositories.mediaAssets.lockById(
        tx,
        tenantId,
        parsed.mediaAssetId,
      );
      if (asset === null) {
        throw new MediaAssetNotFoundError();
      }
      if (
        parsed.expectedVersion !== undefined &&
        parsed.expectedVersion !== asset.version
      ) {
        throw new MediaAssetConflictError();
      }
      if (!canTransition(asset.status, parsed.status)) {
        throw new MediaTransitionError(asset.status, parsed.status);
      }

      const now = new Date().toISOString();
      const updated = await repositories.mediaAssets.transitionStatus(tx, {
        tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        status: parsed.status,
        ...(parsed.status === "READY" ? { readyAt: now } : {}),
        ...(parsed.status === "DELETED" ? { deletedAt: now } : {}),
      });
      if (updated === null) {
        throw new MediaAssetConflictError();
      }
      return updated;
    });
  };
}

export const AttachProviderAssetInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    mediaAssetId: MediaAssetIdSchema,
    provider: MediaProviderSchema,
    providerAssetId: ProviderAssetIdSchema,
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type AttachProviderAssetInput = z.infer<
  typeof AttachProviderAssetInputSchema
>;

/**
 * Records which external asset holds the bytes.
 *
 * Attaching a provider asset is integration bookkeeping, not authorization:
 * the identifier it stores never grants anyone the right to play the media.
 * An asset that already names a provider asset is not re-pointed — that
 * would orphan bytes and break the link between a record and its history.
 */
export function createAttachProviderAsset(dependencies: LifecycleDependencies) {
  const { repositories, transactions } = dependencies;
  return async (input: AttachProviderAssetInput): Promise<MediaAsset> => {
    const parsed = AttachProviderAssetInputSchema.parse(input);
    const tenantId = parsed.tenantId as TenantId;
    if (parsed.provider === "UNASSIGNED") {
      throw new MediaRuleError("A provider asset needs a real provider.");
    }

    return transactions.run(async (tx) => {
      const asset = await repositories.mediaAssets.lockById(
        tx,
        tenantId,
        parsed.mediaAssetId,
      );
      if (asset === null) {
        throw new MediaAssetNotFoundError();
      }
      if (
        parsed.expectedVersion !== undefined &&
        parsed.expectedVersion !== asset.version
      ) {
        throw new MediaAssetConflictError();
      }
      if (asset.providerAssetId !== null) {
        throw new MediaRuleError(
          "This media asset already references a provider asset.",
        );
      }
      if (asset.status === "DELETED") {
        throw new MediaRuleError("A deleted media asset takes no new bytes.");
      }
      const updated = await repositories.mediaAssets.setProviderReference(tx, {
        tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        provider: parsed.provider,
        providerAssetId: parsed.providerAssetId,
      });
      if (updated === null) {
        throw new MediaAssetConflictError();
      }
      return updated;
    });
  };
}

export const RecordProviderMetadataInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    mediaAssetId: MediaAssetIdSchema,
    metadata: MediaTechnicalMetadataSchema,
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type RecordProviderMetadataInput = z.infer<
  typeof RecordProviderMetadataInputSchema
>;

/**
 * Records provider-normalised technical facts: duration, dimensions, aspect
 * ratio, poster reference. They describe a file. They are not inputs to fit,
 * ranking or assessment, and no consumer may treat them as quality.
 */
export function createRecordProviderMetadata(
  dependencies: LifecycleDependencies,
) {
  const { repositories, transactions } = dependencies;
  return async (input: RecordProviderMetadataInput): Promise<MediaAsset> => {
    const parsed = RecordProviderMetadataInputSchema.parse(input);
    const tenantId = parsed.tenantId as TenantId;

    return transactions.run(async (tx) => {
      const asset = await repositories.mediaAssets.lockById(
        tx,
        tenantId,
        parsed.mediaAssetId,
      );
      if (asset === null) {
        throw new MediaAssetNotFoundError();
      }
      if (
        parsed.expectedVersion !== undefined &&
        parsed.expectedVersion !== asset.version
      ) {
        throw new MediaAssetConflictError();
      }
      if (asset.status === "DELETED") {
        throw new MediaRuleError("A deleted media asset is not updated.");
      }
      const updated = await repositories.mediaAssets.updateProviderMetadata(
        tx,
        {
          tenantId,
          mediaAssetId: asset.id,
          expectedVersion: asset.version,
          metadata: parsed.metadata,
        },
      );
      if (updated === null) {
        throw new MediaAssetConflictError();
      }
      return updated;
    });
  };
}

export const SetMediaStatesInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    mediaAssetId: MediaAssetIdSchema,
    playbackPolicy: PlaybackPolicySchema.optional(),
    moderationStatus: ModerationStatusSchema.optional(),
    captionState: CaptionStateSchema.optional(),
    transcriptState: TranscriptStateSchema.optional(),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.playbackPolicy !== undefined ||
      value.moderationStatus !== undefined ||
      value.captionState !== undefined ||
      value.transcriptState !== undefined,
    "at least one state must change",
  );
export type SetMediaStatesInput = z.infer<typeof SetMediaStatesInputSchema>;

/**
 * Sets the axes that are not the lifecycle: how playback may be authorised,
 * what review decided, and whether captions or a transcript exist.
 *
 * They stay separate because they answer different questions. A perfectly
 * encoded video may be blocked; an allowed video may still be private; a
 * video with captions is not therefore approved. Collapsing any two of them
 * would let one decision silently make another.
 */
export function createSetMediaStates(dependencies: LifecycleDependencies) {
  const { repositories, transactions } = dependencies;
  return async (input: SetMediaStatesInput): Promise<MediaAsset> => {
    const parsed = SetMediaStatesInputSchema.parse(input);
    const tenantId = parsed.tenantId as TenantId;

    return transactions.run(async (tx) => {
      const asset = await repositories.mediaAssets.lockById(
        tx,
        tenantId,
        parsed.mediaAssetId,
      );
      if (asset === null) {
        throw new MediaAssetNotFoundError();
      }
      if (
        parsed.expectedVersion !== undefined &&
        parsed.expectedVersion !== asset.version
      ) {
        throw new MediaAssetConflictError();
      }
      if (asset.status === "DELETED") {
        // A deleted asset is not re-opened by widening its policy.
        throw new MediaRuleError("A deleted media asset is not updated.");
      }
      const updated = await repositories.mediaAssets.setStates(tx, {
        tenantId,
        mediaAssetId: asset.id,
        expectedVersion: asset.version,
        ...(parsed.playbackPolicy === undefined
          ? {}
          : { playbackPolicy: parsed.playbackPolicy }),
        ...(parsed.moderationStatus === undefined
          ? {}
          : { moderationStatus: parsed.moderationStatus }),
        ...(parsed.captionState === undefined
          ? {}
          : { captionState: parsed.captionState }),
        ...(parsed.transcriptState === undefined
          ? {}
          : { transcriptState: parsed.transcriptState }),
      });
      if (updated === null) {
        throw new MediaAssetConflictError();
      }
      return updated;
    });
  };
}
