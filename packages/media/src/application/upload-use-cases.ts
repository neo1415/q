import {
  auditActorFromContext,
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  DEFAULT_PITCH_DURATION_POLICY,
  isPitchPlayable,
  toCompanyPitch,
  type MediaAsset,
  type MediaAssetId,
  type MediaOwnerRef,
  type MediaStatus,
  type MediaTechnicalMetadata,
} from "../contracts/index.js";
import type {
  PlaybackAuthorization,
  VideoAssetStatus,
  VideoUploadSession,
} from "../contracts/provider.js";
import {
  MediaAssetConflictError,
  MediaAssetNotFoundError,
  MediaOwnerNotFoundError,
  MediaRuleError,
} from "../domain/errors.js";
import { transitionPath } from "../domain/lifecycle.js";
import type { ResolvedMediaOwner } from "../domain/owners.js";
import { mediaAssetStatusChangedEvent } from "../events/index.js";
import {
  activeOrganisation,
  MEDIA_CREATE,
  MEDIA_VIEW,
  ownedResource,
  ownerScope,
} from "./authority.js";
import type { MediaServiceDependencies } from "./dependencies.js";

/**
 * The direct upload flow, server side (CQ-MEDIA-011; doc 20 §9–§14, §20,
 * §31–§32).
 *
 * Three operations, and what each one refuses to be:
 *
 *   reserve   — asks the provider for a one-time upload target on the
 *               server's terms and records that it did. Not an upload.
 *   sync      — asks the provider where the bytes stand and walks the
 *               lifecycle to match, one legal step at a time. Not a
 *               webhook: it is the founder's own poll, and it never moves
 *               an asset anywhere the lifecycle forbids.
 *   playback  — decides whether this viewer may watch, then asks the
 *               provider to permit it. The provider's identifier is never
 *               the decision; it is not even in the answer.
 *
 * No provider call happens inside a transaction. The vendor is asked
 * first, with nothing locked; what it said is then applied under a row
 * lock against the version that was read, so a slow vendor holds no lock
 * and a concurrent writer is detected rather than overwritten.
 */

const RESOURCE_MEDIA = AuditResourceTypeSchema.parse("media_asset");
const ACTION = {
  reserved: AuditActionTypeSchema.parse("media.asset.upload_reserved"),
  synced: AuditActionTypeSchema.parse("media.asset.synced"),
};

const PITCH = "FOUNDER_PITCH" as const;
/** A viewer's grant outlives a pitch by a comfortable margin, and no more. */
const PLAYBACK_TTL_SECONDS = 15 * 60;

function companyRef(companyId: string): MediaOwnerRef {
  return { ownerType: "COMPANY", ownerId: companyId };
}

function belongsTo(asset: MediaAsset, owner: ResolvedMediaOwner): boolean {
  return (
    asset.ownerType === owner.ownerType &&
    asset.ownerId === owner.ownerId &&
    asset.purpose === PITCH
  );
}

/** `1080 × 1920` → `9:16`; anything that will not reduce to three digits stays unknown. */
export function aspectRatioOf(
  width: number,
  height: number,
): string | undefined {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  return w > 999 || h > 999 ? undefined : `${String(w)}:${String(h)}`;
}

/** What the provider told us that the record does not yet hold. */
function metadataDelta(
  asset: MediaAsset,
  status: VideoAssetStatus,
): MediaTechnicalMetadata | null {
  const delta: {
    -readonly [K in keyof MediaTechnicalMetadata]: MediaTechnicalMetadata[K];
  } = {};
  if (
    status.durationSeconds !== undefined &&
    status.durationSeconds !== asset.durationSeconds
  ) {
    delta.durationSeconds = status.durationSeconds;
  }
  if (status.width !== undefined && status.width !== asset.width) {
    delta.width = status.width;
  }
  if (status.height !== undefined && status.height !== asset.height) {
    delta.height = status.height;
  }
  if (status.width !== undefined && status.height !== undefined) {
    const ratio = aspectRatioOf(status.width, status.height);
    if (ratio !== undefined && ratio !== asset.aspectRatio) {
      delta.aspectRatio = ratio;
    }
  }
  if (
    status.thumbnailReference !== undefined &&
    status.thumbnailReference !== asset.thumbnailReference
  ) {
    delta.thumbnailReference = status.thumbnailReference;
  }
  return Object.keys(delta).length === 0 ? null : delta;
}

// ---------------------------------------------------------------------------
// Reserve an upload
// ---------------------------------------------------------------------------

export type CreateUploadSessionCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  /** The version the caller saw. A stale tab does not reopen an upload. */
  readonly expectedVersion: number;
  readonly correlationId: CorrelationId;
};

export type UploadSessionResult = {
  readonly asset: MediaAsset;
  readonly session: VideoUploadSession;
  /** The server's reservation, so the client can say what it may not exceed. */
  readonly maxDurationSeconds: number;
};

/**
 * Reserves a one-time upload target for a CREATED pitch.
 *
 * Every term is the server's: the duration allowance is the product's hard
 * maximum, the target's expiry is the adapter's, and playback is signed
 * unless the asset's own policy is PUBLIC. The one-time URL is handed back
 * exactly once and never stored; the provider's identifier is stored and
 * never handed back. An asset that already holds a target is refused
 * rather than re-issued, because a second reservation would orphan the
 * first and the record would name bytes that never arrive.
 */
export function createCreateUploadSession(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, transactions, audit, outbox, videoProvider } =
    dependencies;

  return async (
    command: CreateUploadSessionCommand,
  ): Promise<UploadSessionResult> => {
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const owner = await ownedResource(
      dependencies,
      actor,
      companyRef(command.companyId),
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: MEDIA_CREATE,
      resource: ownerScope(actor, owner),
    });

    const asset = await repositories.mediaAssets.findById(
      dependencies.sql,
      owner.tenantId,
      command.mediaAssetId,
    );
    if (asset === null || !belongsTo(asset, owner)) {
      throw new MediaAssetNotFoundError();
    }
    if (asset.version !== command.expectedVersion) {
      throw new MediaAssetConflictError();
    }
    if (asset.status !== "CREATED" || asset.providerAssetId !== null) {
      throw new MediaRuleError(
        asset.status === "CREATED"
          ? "This pitch already has an upload target."
          : `A ${asset.status} pitch cannot start an upload; replace the pitch instead.`,
      );
    }

    // The vendor first, with nothing locked.
    const maxDurationSeconds = DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds;
    const session = await videoProvider.createUploadSession({
      mediaAssetId: asset.id,
      purpose: asset.purpose,
      maxDurationSeconds,
      requireSignedPlayback: asset.playbackPolicy !== "PUBLIC",
    });

    const updated = await transactions.run(async (tx: TransactionContext) => {
      const locked = await repositories.mediaAssets.lockById(
        tx,
        owner.tenantId,
        asset.id,
      );
      if (locked === null) {
        throw new MediaAssetNotFoundError();
      }
      if (locked.version !== asset.version) {
        throw new MediaAssetConflictError();
      }
      const attached = await repositories.mediaAssets.setProviderReference(tx, {
        tenantId: owner.tenantId,
        mediaAssetId: asset.id,
        expectedVersion: locked.version,
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: session.providerAssetId,
      });
      if (attached === null) {
        throw new MediaAssetConflictError();
      }
      const pending = await repositories.mediaAssets.transitionStatus(tx, {
        tenantId: owner.tenantId,
        mediaAssetId: asset.id,
        expectedVersion: attached.version,
        status: "UPLOAD_PENDING",
      });
      if (pending === null) {
        throw new MediaAssetConflictError();
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.reserved,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        // Terms, never the target: the one-time URL is not audit material.
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          status: pending.status,
          uploadMode: session.uploadMode,
          maxDurationSeconds,
          requireSignedPlayback: asset.playbackPolicy !== "PUBLIC",
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        mediaAssetStatusChangedEvent(
          { actor, organisationId, correlationId: command.correlationId },
          pending.version,
          {
            mediaAssetId: asset.id,
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            purpose: asset.purpose,
            previousStatus: asset.status,
            status: pending.status,
          },
        ),
      );
      return pending;
    });

    return { asset: updated, session, maxDurationSeconds };
  };
}

// ---------------------------------------------------------------------------
// Sync with the provider
// ---------------------------------------------------------------------------

export type SyncMediaAssetCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  readonly correlationId: CorrelationId;
};

/**
 * Brings the record in line with what the provider reports, idempotently.
 *
 * The provider's state is translated by its adapter; here it is only a
 * destination. If the lifecycle admits a path from where the asset is to
 * where the provider says it is, every step of that path is applied and
 * recorded. If it admits none — the provider says PROCESSING for an asset
 * that is READY, or reports a lapsed target for one that is already
 * uploading — nothing moves, because the record already knows better.
 * Calling this twice, or after the asset is terminal, changes nothing and
 * emits nothing.
 */
export function createSyncMediaAsset(dependencies: MediaServiceDependencies) {
  const { repositories, transactions, audit, outbox, videoProvider } =
    dependencies;

  return async (command: SyncMediaAssetCommand): Promise<MediaAsset> => {
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const owner = await ownedResource(
      dependencies,
      actor,
      companyRef(command.companyId),
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: MEDIA_CREATE,
      resource: ownerScope(actor, owner),
    });

    const asset = await repositories.mediaAssets.findById(
      dependencies.sql,
      owner.tenantId,
      command.mediaAssetId,
    );
    if (asset === null || !belongsTo(asset, owner)) {
      throw new MediaAssetNotFoundError();
    }
    // Nothing to ask about: no provider asset, or a decision already made.
    if (asset.providerAssetId === null || asset.status === "DELETED") {
      return asset;
    }

    const reported = await videoProvider.getAsset(asset.providerAssetId);
    const path = transitionPath(asset.status, reported.status);
    const metadata = metadataDelta(asset, reported);
    if ((path === null || path.length === 0) && metadata === null) {
      return asset;
    }

    return transactions.run(async (tx: TransactionContext) => {
      let current = await repositories.mediaAssets.lockById(
        tx,
        owner.tenantId,
        asset.id,
      );
      if (current === null) {
        throw new MediaAssetNotFoundError();
      }
      if (current.version !== asset.version) {
        // Somebody else applied something meanwhile. Their view of the
        // provider is as good as ours; the next poll starts from theirs.
        throw new MediaAssetConflictError();
      }

      if (metadata !== null) {
        const described = await repositories.mediaAssets.updateProviderMetadata(
          tx,
          {
            tenantId: owner.tenantId,
            mediaAssetId: asset.id,
            expectedVersion: current.version,
            metadata,
          },
        );
        if (described === null) {
          throw new MediaAssetConflictError();
        }
        current = described;
      }

      const applied: MediaStatus[] = [];
      for (const next of path ?? []) {
        const previous = current.status;
        const moved = await repositories.mediaAssets.transitionStatus(tx, {
          tenantId: owner.tenantId,
          mediaAssetId: asset.id,
          expectedVersion: current.version,
          status: next,
          ...(next === "READY" ? { readyAt: new Date().toISOString() } : {}),
        });
        if (moved === null) {
          throw new MediaAssetConflictError();
        }
        current = moved;
        applied.push(next);
        await outbox.enqueue(
          tx,
          mediaAssetStatusChangedEvent(
            { actor, organisationId, correlationId: command.correlationId },
            current.version,
            {
              mediaAssetId: asset.id,
              ownerType: asset.ownerType,
              ownerId: asset.ownerId,
              purpose: asset.purpose,
              previousStatus: previous,
              status: next,
            },
          ),
        );
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.synced,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        // Coded states and the vendor's failure code, never its identifier.
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          previousStatus: asset.status,
          status: current.status,
          appliedTransitions: applied,
          metadataUpdated: metadata !== null,
          ...(reported.providerErrorCode === undefined
            ? {}
            : { providerErrorCode: reported.providerErrorCode }),
        },
        correlationId: command.correlationId,
      });
      return current;
    });
  };
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export type AuthorisePlaybackQuery = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
};

export type PlaybackGrant = {
  readonly asset: MediaAsset;
  readonly authorization: PlaybackAuthorization;
};

/**
 * Whether this viewer may watch, and then the provider's permission.
 *
 * Two kinds of viewer, decided by facts and never by a claimed role. The
 * owner — resolved through the owner registry in the actor's own tenant
 * and organisation — may preview their own pitch as soon as it is READY,
 * whatever its moderation or policy says, because it is theirs. Anyone
 * else is a viewer, and a viewer sees a pitch only when the asset is
 * publishable (READY, moderation ALLOWED, policy not PRIVATE) AND the
 * company is discoverable to them by the Recommendation context's own
 * rule. Every refusal on the viewer path is "not found": a pitch that
 * exists but is private must look exactly like one that does not exist.
 */
export function createAuthorisePlayback(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, videoProvider, viewers } = dependencies;

  const asOwner = async (
    query: AuthorisePlaybackQuery,
  ): Promise<MediaAsset | null> => {
    let owner: ResolvedMediaOwner;
    try {
      owner = await ownedResource(
        dependencies,
        query.actor,
        companyRef(query.companyId),
      );
    } catch (error) {
      if (error instanceof MediaOwnerNotFoundError) {
        return null;
      }
      throw error;
    }
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: MEDIA_VIEW,
      resource: ownerScope(query.actor, owner),
    });
    const asset = await repositories.mediaAssets.findById(
      dependencies.sql,
      owner.tenantId,
      query.mediaAssetId,
    );
    if (asset === null || !belongsTo(asset, owner)) {
      throw new MediaAssetNotFoundError();
    }
    if (asset.status !== "READY") {
      throw new MediaRuleError("The pitch is not ready to play yet.");
    }
    return asset;
  };

  const asViewer = async (
    query: AuthorisePlaybackQuery,
  ): Promise<MediaAsset> => {
    const company = await viewers.resolveViewableCompany(
      query.actor,
      query.companyId,
    );
    if (company === null) {
      throw new MediaAssetNotFoundError();
    }
    const asset = await repositories.mediaAssets.findById(
      dependencies.sql,
      company.tenantId,
      query.mediaAssetId,
    );
    if (
      asset === null ||
      asset.ownerType !== "COMPANY" ||
      asset.ownerId !== query.companyId ||
      asset.ownerOrganisationId !== company.ownerOrganisationId ||
      !isPitchPlayable(toCompanyPitch(asset))
    ) {
      throw new MediaAssetNotFoundError();
    }
    return asset;
  };

  return async (query: AuthorisePlaybackQuery): Promise<PlaybackGrant> => {
    const asset = (await asOwner(query)) ?? (await asViewer(query));
    if (asset.providerAssetId === null) {
      // READY without bytes cannot happen through this code; if a row says
      // so, it is not something to play.
      throw new MediaAssetNotFoundError();
    }
    const authorization = await videoProvider.createPlaybackAuthorization({
      mediaAssetId: asset.id,
      providerAssetId: asset.providerAssetId,
      accessMode: asset.playbackPolicy,
      ttlSeconds: PLAYBACK_TTL_SECONDS,
    });
    return { asset, authorization };
  };
}
