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
  toDiscoverablePitch,
  type MediaAsset,
  type MediaAssetId,
  type MediaOwnerRef,
} from "../contracts/index.js";
import type {
  DownloadAuthorization,
  PlaybackAuthorization,
  VideoUploadSession,
} from "../contracts/provider.js";
import {
  MediaAssetConflictError,
  MediaAssetNotFoundError,
  MediaOwnerNotFoundError,
  MediaProviderNotConfiguredError,
  MediaRuleError,
} from "../domain/errors.js";
import type { ResolvedMediaOwner } from "../domain/owners.js";
import {
  MAX_PITCH_UPLOAD_BYTES,
  uploadReservationKey,
} from "../domain/upload-reservation.js";
import { mediaAssetStatusChangedEvent } from "../events/index.js";
import {
  activeOrganisation,
  MEDIA_CREATE,
  MEDIA_VIEW,
  ownedResource,
  ownerScope,
} from "./authority.js";
import type { MediaServiceDependencies } from "./dependencies.js";
import {
  applyProviderReportPlan,
  isEmptyPlan,
  planProviderReport,
} from "./provider-report.js";

/**
 * The direct upload flow, server side (CQ-MEDIA-011; doc 20 §9–§14, §20,
 * §31–§32).
 *
 * Three operations, and what each one refuses to be:
 *
 *   reserve   — asks the provider for an upload target (one-shot, or
 *               resumable tus) on the server's terms and records that it
 *               did. Not an upload. A retry of the same resumable request
 *               gets the same target back, never a second one.
 *   cancel    — the founder stops an unfinished upload: the record says
 *               UPLOAD_FAILED and the provider lets go of its asset.
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
  cancelled: AuditActionTypeSchema.parse("media.asset.upload_cancelled"),
  synced: AuditActionTypeSchema.parse("media.asset.synced"),
};

const PITCH = "FOUNDER_PITCH" as const;
/** A viewer's grant outlives a pitch by a comfortable margin, and no more. */
const PLAYBACK_TTL_SECONDS = 15 * 60;
/** ADR 0047: long enough to start the download, short enough not to share. */
const DOWNLOAD_TTL_SECONDS = 5 * 60;

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

// ---------------------------------------------------------------------------
// Reserve an upload
// ---------------------------------------------------------------------------

export type CreateUploadSessionCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  /** The version the caller saw. A stale tab does not reopen an upload. */
  readonly expectedVersion: number;
  /**
   * The file's exact size, from a client that can resume. With a provider
   * that supports it this asks for a RESUMABLE target; without either, the
   * one-shot DIRECT target is issued as before.
   */
  readonly uploadLengthBytes?: number | undefined;
  /**
   * The client's key for this intended reservation, reused on retry.
   * Required with `uploadLengthBytes`: it is what lets a retry, or a
   * reload, get back the same resumable target instead of a refusal.
   */
  readonly idempotencyKey?: string | undefined;
  readonly correlationId: CorrelationId;
};

export type UploadSessionResult = {
  readonly asset: MediaAsset;
  readonly session: VideoUploadSession;
  /** The server's reservation, so the client can say what it may not exceed. */
  readonly maxDurationSeconds: number;
  /** True when a retried request was answered with the target it opened. */
  readonly replayed: boolean;
};

/**
 * Reserves an upload target for a CREATED pitch.
 *
 * Every term is the server's: the mode (resumable when the provider can
 * and the client said how many bytes), the duration allowance (the
 * product's hard maximum), the target's expiry (the adapter's), and signed
 * playback unless the asset's own policy is PUBLIC. The target is never
 * stored; the provider's identifier is stored and never handed back.
 *
 * An asset that already holds a target is refused rather than re-issued —
 * a second reservation would orphan the first — with one exception that is
 * not a second reservation at all: the same request again. A RESUMABLE
 * reservation carries a digest of (asset, length, idempotency key) on the
 * provider's record, so a retry whose digest matches, while the target is
 * still open, is answered with that same target. Nothing changes, nothing
 * is emitted, and the version check is not applied, because the retry's
 * version is by definition the one from before its own first attempt.
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

    const maxDurationSeconds = DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds;
    const resumable = resumableTerms(
      command,
      asset.id,
      videoProvider.capabilities.resumableUpload,
    );

    // The same request again: answered from the provider's own record,
    // or not at all.
    if (
      resumable !== null &&
      asset.status === "UPLOAD_PENDING" &&
      asset.providerAssetId !== null
    ) {
      const reopened = await videoProvider.resumeUploadSession({
        mediaAssetId: asset.id,
        providerAssetId: asset.providerAssetId,
        reservationKey: resumable.reservationKey,
      });
      if (reopened !== null) {
        return {
          asset,
          session: reopened,
          maxDurationSeconds,
          replayed: true,
        };
      }
      throw new MediaRuleError(
        "This pitch already has an upload target that this request did not open.",
      );
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
    const session = await videoProvider.createUploadSession({
      mediaAssetId: asset.id,
      purpose: asset.purpose,
      maxDurationSeconds,
      requireSignedPlayback: asset.playbackPolicy !== "PUBLIC",
      ...(resumable === null
        ? {}
        : {
            uploadLengthBytes: resumable.uploadLengthBytes,
            reservationKey: resumable.reservationKey,
          }),
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
          ...(resumable === null
            ? {}
            : { uploadLengthBytes: resumable.uploadLengthBytes }),
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

    return { asset: updated, session, maxDurationSeconds, replayed: false };
  };
}

/**
 * The resumable terms of a request, or null for the one-shot target.
 *
 * A client that sent no length gets DIRECT, as before. A provider that
 * cannot resume gives DIRECT too, and the client uploads whichever mode
 * the answer names. A length without a key, or a length no pitch could
 * be, is refused: the first could never be retried safely, and the second
 * would hold a provider reservation open for nothing.
 */
function resumableTerms(
  command: CreateUploadSessionCommand,
  mediaAssetId: MediaAssetId,
  providerCanResume: boolean,
): {
  readonly uploadLengthBytes: number;
  readonly reservationKey: string;
} | null {
  const { uploadLengthBytes, idempotencyKey } = command;
  if (uploadLengthBytes === undefined || !providerCanResume) {
    return null;
  }
  if (idempotencyKey === undefined) {
    throw new MediaRuleError(
      "A resumable upload needs an idempotency key so it can be retried.",
    );
  }
  if (
    !Number.isInteger(uploadLengthBytes) ||
    uploadLengthBytes < 1 ||
    uploadLengthBytes > MAX_PITCH_UPLOAD_BYTES
  ) {
    throw new MediaRuleError(
      "That file is larger than a pitch could be. Trim it or export at a lower bitrate.",
    );
  }
  return {
    uploadLengthBytes,
    reservationKey: uploadReservationKey({
      mediaAssetId,
      uploadLengthBytes,
      idempotencyKey,
    }),
  };
}

// ---------------------------------------------------------------------------
// Cancel an upload
// ---------------------------------------------------------------------------

export type CancelUploadCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly mediaAssetId: MediaAssetId;
  readonly correlationId: CorrelationId;
};

export type CancelUploadResult = {
  readonly asset: MediaAsset;
  /**
   * Whether the provider let go of its asset. False means the record is
   * already honest and the provider's target will lapse at its expiry; a
   * repeat of the cancel tries the release again.
   */
  readonly providerReleased: boolean;
};

/**
 * The founder stops an upload that has not finished.
 *
 * The record moves first, to UPLOAD_FAILED — the lifecycle's own word for
 * "the bytes did not arrive", legal from both UPLOAD_PENDING and UPLOADING
 * — with the reason in the audit. Then, outside any transaction, the
 * provider's asset is deleted: that releases its storage reservation and
 * kills the upload target, so a tab still sending bytes is refused by the
 * provider rather than completing into a record that has already said no.
 * If bytes did land in the gap, the lifecycle refuses every later report
 * for a terminal asset, so the record cannot be walked back to READY.
 *
 * Idempotent: cancelling an upload that is already UPLOAD_FAILED changes
 * nothing and only retries the provider release. Anything that is not an
 * upload in flight is refused; deleting a pitch is a different decision
 * with its own capability.
 */
export function createCancelUpload(dependencies: MediaServiceDependencies) {
  const { repositories, transactions, audit, outbox, videoProvider } =
    dependencies;

  const release = async (providerAssetId: string | null): Promise<boolean> => {
    if (providerAssetId === null) return true;
    try {
      await videoProvider.deleteAsset(providerAssetId);
      return true;
    } catch {
      return false;
    }
  };

  return async (command: CancelUploadCommand): Promise<CancelUploadResult> => {
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
    if (asset.status === "UPLOAD_FAILED") {
      return {
        asset,
        providerReleased: await release(asset.providerAssetId),
      };
    }
    if (asset.status !== "UPLOAD_PENDING" && asset.status !== "UPLOADING") {
      throw new MediaRuleError(
        `A ${asset.status} pitch has no upload in progress to cancel.`,
      );
    }

    const cancelled = await transactions.run(async (tx: TransactionContext) => {
      const locked = await repositories.mediaAssets.lockById(
        tx,
        owner.tenantId,
        asset.id,
      );
      if (locked === null) {
        throw new MediaAssetNotFoundError();
      }
      if (locked.version !== asset.version) {
        // A webhook or a sync moved it meanwhile — perhaps the bytes
        // finished. The caller re-reads rather than cancelling blind.
        throw new MediaAssetConflictError();
      }
      const failed = await repositories.mediaAssets.transitionStatus(tx, {
        tenantId: owner.tenantId,
        mediaAssetId: asset.id,
        expectedVersion: locked.version,
        status: "UPLOAD_FAILED",
      });
      if (failed === null) {
        throw new MediaAssetConflictError();
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.cancelled,
        resourceType: RESOURCE_MEDIA,
        resourceId: asset.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          purpose: asset.purpose,
          previousStatus: asset.status,
          status: failed.status,
          reason: "CANCELLED_BY_CREATOR",
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        mediaAssetStatusChangedEvent(
          { actor, organisationId, correlationId: command.correlationId },
          failed.version,
          {
            mediaAssetId: asset.id,
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            purpose: asset.purpose,
            previousStatus: asset.status,
            status: failed.status,
          },
        ),
      );
      return failed;
    });

    return {
      asset: cancelled,
      providerReleased: await release(cancelled.providerAssetId),
    };
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
    const plan = planProviderReport(asset, reported);
    if (isEmptyPlan(plan)) {
      return asset;
    }

    return transactions.run(async (tx: TransactionContext) => {
      const locked = await repositories.mediaAssets.lockById(
        tx,
        owner.tenantId,
        asset.id,
      );
      if (locked === null) {
        throw new MediaAssetNotFoundError();
      }
      if (locked.version !== asset.version) {
        // Somebody else applied something meanwhile — a webhook, or another
        // tab. Their view of the provider is as good as ours; the next poll
        // starts from theirs.
        throw new MediaAssetConflictError();
      }

      const { asset: current, applied } = await applyProviderReportPlan(
        tx,
        { repositories, outbox },
        locked,
        plan,
        { actor, organisationId, correlationId: command.correlationId },
      );

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
          appliedTransitions: [...applied],
          metadataUpdated: plan.metadata !== null,
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
 * publishable (the company's current pitch -- not superseded, not deleted
 * -- READY, moderation ALLOWED, policy not PRIVATE) AND the
 * company is discoverable to them by the Recommendation context's own
 * rule. Every refusal on the viewer path is "not found": a pitch that
 * exists but is private must look exactly like one that does not exist.
 */
/**
 * The one rule for "may this actor play this pitch" (CQ-MEDIA-011, R18):
 * the owner, or a viewer the feed would show it to. Playback tokens and
 * the pitch's transcript are both decided here, so a transcript can never
 * be read by anyone who could not watch the video.
 */
export function createResolvePlayableAsset(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, viewers } = dependencies;

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
    // An investor the feed would show the company to may watch any of its
    // publishable videos; anyone else signed in, only a video its owner
    // opened to the network (ADR 0021), and only while the company itself
    // is visible to the network.
    const asInvestor = await viewers.resolveViewableCompany(
      query.actor,
      query.companyId,
    );
    const company =
      asInvestor ??
      (viewers.resolveNetworkCompany === undefined
        ? null
        : await viewers.resolveNetworkCompany(query.actor, query.companyId));
    if (company === null) {
      throw new MediaAssetNotFoundError();
    }
    const asset = await repositories.mediaAssets.findById(
      dependencies.sql,
      company.tenantId,
      query.mediaAssetId,
    );
    // The feed's own rule, not a looser one: a viewer may be granted exactly
    // the pitch the feed and the profile would show them. `isPitchPlayable`
    // alone let a superseded pitch keep minting tokens for anyone holding
    // its id -- during a replacement, and forever after it (CQ-MLV-001).
    if (
      asset === null ||
      asset.ownerId !== query.companyId ||
      asset.ownerOrganisationId !== company.ownerOrganisationId ||
      toDiscoverablePitch(asset) === null ||
      (asInvestor === null && asset.audience !== "NETWORK")
    ) {
      throw new MediaAssetNotFoundError();
    }
    return asset;
  };
  return async (query: AuthorisePlaybackQuery): Promise<MediaAsset> =>
    (await asOwner(query)) ?? (await asViewer(query));
}

export function createAuthorisePlayback(
  dependencies: MediaServiceDependencies,
) {
  const { videoProvider } = dependencies;
  const playable = createResolvePlayableAsset(dependencies);
  return async (query: AuthorisePlaybackQuery): Promise<PlaybackGrant> => {
    const asset = await playable(query);
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

export type AuthoriseDownloadQuery = AuthorisePlaybackQuery;

/** A file name made of safe characters, from display text. */
export function downloadFileName(label: string | null): string {
  const stem = (label ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return `${stem === "" ? "pitch" : `${stem}-pitch`}.mp4`;
}

/**
 * ADR 0047. Decided on every request, in this order: the one playback rule
 * (owner, or a viewer the feed would show it to), then the owner's
 * download permission for a viewer. Every refusal is "not found", exactly
 * as for a pitch the viewer may not watch: a watch-only pitch and a pitch
 * that does not exist look the same from outside. The owner may always
 * save their own pitch.
 */
export function createAuthoriseDownload(
  dependencies: MediaServiceDependencies,
) {
  const { videoProvider } = dependencies;
  const playable = createResolvePlayableAsset(dependencies);
  return async (
    query: AuthoriseDownloadQuery,
  ): Promise<DownloadAuthorization> => {
    const asset = await playable(query);
    // The owner's own organisation; anyone else is a viewer. Decided from
    // the actor's server-resolved context, never from anything sent.
    const isOwner =
      query.actor.organisationId !== undefined &&
      asset.ownerOrganisationId === query.actor.organisationId;
    if (
      asset.providerAssetId === null ||
      asset.purpose !== "FOUNDER_PITCH" ||
      (!isOwner && !asset.downloadable)
    ) {
      throw new MediaAssetNotFoundError();
    }
    if (videoProvider.createDownloadAuthorization === undefined) {
      throw new MediaProviderNotConfiguredError("download", []);
    }
    return videoProvider.createDownloadAuthorization({
      mediaAssetId: asset.id,
      providerAssetId: asset.providerAssetId,
      accessMode: asset.playbackPolicy,
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
      // The owner's own title for the video, reduced to safe characters.
      fileName: downloadFileName(asset.title),
    });
  };
}
