import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
} from "@capital-q/security";

import type {
  CaptionState,
  CompanyPitch,
  DiscoverablePitch,
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
  /**
   * The asset a provider's identifier names, in whichever tenant holds it
   * (CQ-MEDIA-012). Cross-tenant by necessity — a provider webhook carries
   * no tenant — and therefore a lookup only: the caller has already
   * verified the delivery's signature, and everything it then does goes
   * through `lockById` with the tenant this row states. Knowing an
   * identifier is never a reason to act on the asset it names.
   */
  readonly findByProviderAssetId: (
    executor: DatabaseExecutor,
    provider: MediaProvider,
    providerAssetId: string,
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

/**
 * The feed's read port (CQ-MEDIA-012; doc 20 §74, §78).
 *
 * Batched and cross-tenant by design: the feed page names companies from
 * many tenants, and the reader that assembled the page has already decided
 * this viewer may see every one of them. What comes back is therefore
 * bounded to what is publishable — a pitch that is not READY, not ALLOWED
 * or PRIVATE is simply absent, indistinguishable from a company with no
 * pitch — and carries nothing that grants playback. Discovery never reads
 * media tables; this is the whole of what it may ask.
 */
export type DiscoverablePitchQueryPort = {
  /** One query per call. Refuses more than DISCOVERABLE_PITCH_BATCH_MAX ids. */
  readonly findDiscoverablePitches: (
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, DiscoverablePitch>>;
};

/**
 * The idempotency record for creating or replacing a pitch (doc 22 §43).
 * Keyed by person, organisation and the hash of the client's key; holds
 * the hash of what the request meant and the asset it created. Every
 * method runs inside the creation transaction.
 */
export type PitchRequestStore = {
  /** Serialises two requests carrying the same key until commit. */
  readonly lock: (
    tx: TransactionContext,
    userId: string,
    organisationId: string,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: string,
    organisationId: string,
    idempotencyKeyHash: string,
  ) => Promise<{
    readonly requestHash: string;
    readonly mediaAssetId: MediaAssetId;
  } | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: string;
      readonly organisationId: string;
      readonly tenantId: TenantId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly mediaAssetId: MediaAssetId;
    },
  ) => Promise<void>;
};

export type MediaRepositories = {
  readonly mediaAssets: MediaAssetRepository;
  /**
   * Absent in a composition without one (unit doubles): a request that
   * carries an idempotency key is then refused rather than run without the
   * guarantee it asked for.
   */
  readonly pitchRequests?: PitchRequestStore | undefined;
};

/**
 * May this actor, who does not own the company, view its pitch right now
 * (CQ-MEDIA-011)?
 *
 * Media does not decide that. Discoverability is the Recommendation
 * context's REC-001 rule — the company is active and network-visible, the
 * disclosure evaluator admits this viewer, no hard exclusion stands — and
 * this port is how the composition root hands that exact evaluation in,
 * so playback cannot drift from what the feed shows. Null is the only
 * refusal, and it is indistinguishable from a company that never existed.
 *
 * The company's tenant comes back with the answer because the viewer is in
 * another tenant, and every media read is tenant-scoped by construction.
 */
export type PitchViewerAccessPort = {
  readonly resolveViewableCompany: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<{
    readonly tenantId: TenantId;
    readonly ownerOrganisationId: OrganisationId;
  } | null>;
};

export type { OrganisationId };
