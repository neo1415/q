import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId } from "@capital-q/security";

import type {
  CaptionState,
  CompanyPitch,
  MediaAsset,
  MediaAssetId,
  MediaOwnerType,
  MediaProvider,
  MediaPurpose,
  MediaStatus,
  MediaTechnicalMetadata,
  ModerationStatus,
  NewMediaAsset,
  PlaybackPolicy,
  TranscriptState,
} from "../contracts/index.js";

/**
 * Persistence ports for the Media context.
 *
 * Every method is a named operation with its own rules. There is
 * deliberately no `update(id, patch)`: a generic patch is how a status, a
 * provider identifier or a moderation verdict ends up being set by whoever
 * happened to be holding the row, which is exactly what the lifecycle and
 * the trust boundary exist to prevent.
 */

export type MediaAssetRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewMediaAsset,
  ) => Promise<MediaAsset>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    mediaAssetId: MediaAssetId,
  ) => Promise<MediaAsset | null>;
  /** Row lock for a replacement or a deletion decided from what is current. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    mediaAssetId: MediaAssetId,
  ) => Promise<MediaAsset | null>;
  /**
   * The one live, unsuperseded asset of this purpose for this owner. At most
   * one can exist: the database enforces it with a partial unique index.
   */
  readonly findCurrentForOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    owner: { readonly ownerType: MediaOwnerType; readonly ownerId: string },
    purpose: MediaPurpose,
  ) => Promise<MediaAsset | null>;
  /** Locks the current asset so a replacement decision cannot race. */
  readonly lockCurrentForOwner: (
    tx: TransactionContext,
    tenantId: TenantId,
    owner: { readonly ownerType: MediaOwnerType; readonly ownerId: string },
    purpose: MediaPurpose,
  ) => Promise<MediaAsset | null>;
  /** Newest first, including superseded and deleted assets: this is history. */
  readonly listForOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    owner: { readonly ownerType: MediaOwnerType; readonly ownerId: string },
  ) => Promise<readonly MediaAsset[]>;
  /**
   * Applies one lifecycle move. The expected version is part of the
   * predicate, so a stale writer updates nothing and is told so.
   */
  readonly transitionStatus: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
      readonly status: MediaStatus;
      readonly readyAt?: string | undefined;
      readonly deletedAt?: string | undefined;
    },
  ) => Promise<MediaAsset | null>;
  /**
   * Attaches the external asset. Trusted server operation only: a browser
   * never names the provider or its identifier.
   */
  readonly setProviderReference: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
      readonly provider: MediaProvider;
      readonly providerAssetId: string;
    },
  ) => Promise<MediaAsset | null>;
  /** Provider-normalised technical facts. Absent fields keep their value. */
  readonly updateProviderMetadata: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
      readonly metadata: MediaTechnicalMetadata;
    },
  ) => Promise<MediaAsset | null>;
  /** Marks a predecessor superseded, freeing the single-current-pitch slot. */
  readonly markSuperseded: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
    },
  ) => Promise<MediaAsset | null>;
  /** Review and playback decisions, each on its own axis. */
  readonly setStates: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
      readonly playbackPolicy?: PlaybackPolicy | undefined;
      readonly moderationStatus?: ModerationStatus | undefined;
      readonly captionState?: CaptionState | undefined;
      readonly transcriptState?: TranscriptState | undefined;
    },
  ) => Promise<MediaAsset | null>;
};

/**
 * The read port later consumers depend on — company profile, discovery
 * projection, Q. They ask "does this company have a current pitch and where
 * does it stand", and never read media tables directly.
 */
export type CompanyPitchQueryPort = {
  readonly getCurrentPitchForCompany: (
    tenantId: TenantId,
    companyId: string,
  ) => Promise<CompanyPitch | null>;
};

export type MediaRepositories = {
  readonly mediaAssets: MediaAssetRepository;
};

export type { OrganisationId };
