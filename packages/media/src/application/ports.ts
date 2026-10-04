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
  DiscoverablePitchSet,
  MediaAsset,
  MediaAssetId,
  MediaOwnerType,
  MediaProvider,
  MediaPurpose,
  MediaStatus,
  MediaTechnicalMetadata,
  ModerationStatus,
  NewMediaAsset,
  PitchAudience,
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
   * The newest live (not deleted, not superseded) asset of this purpose for
   * this owner: the one a company's profile leads with. Several may be
   * live at once (ADR 0022).
   */
  readonly findCurrentForOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    owner: { readonly ownerType: MediaOwnerType; readonly ownerId: string },
    purpose: MediaPurpose,
  ) => Promise<MediaAsset | null>;
  /** How many live assets of this purpose the owner has now. */
  readonly countLiveForOwner: (
    tx: TransactionContext,
    tenantId: TenantId,
    owner: { readonly ownerType: MediaOwnerType; readonly ownerId: string },
    purpose: MediaPurpose,
  ) => Promise<number>;
  /** The owner's title and audience for one asset (ADR 0021/0022). */
  readonly setDetails: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
      readonly title: string | null;
      readonly audience: PitchAudience;
    },
  ) => Promise<MediaAsset | null>;
  /** ADR 0047: whether viewers may save a copy of one founder pitch. */
  readonly setDownloadable: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mediaAssetId: MediaAssetId;
      readonly expectedVersion: number;
      readonly downloadable: boolean;
    },
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
  ) => Promise<ReadonlyMap<string, DiscoverablePitchSet>>;
  /**
   * Each company's newest publishable pitch's READY time (ISO), the same
   * rule as `findDiscoverablePitches`; absent when it has none. Lets a
   * passed company with a new pitch be offered again (doc 19 §67).
   */
  readonly latestReadyAt?: (
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
};

/**
 * Videos their owners opened to everyone on Capital Q (ADR 0021), newest
 * first, for the founders' network feed. Cross-tenant like the feed's
 * batched read and bounded the same way: only live, publishable NETWORK
 * videos come back, carrying nothing that grants playback. Whether the
 * company itself may be seen by this viewer is the caller's decision
 * (disclosure), made for every company before anything is shown.
 */
export type NetworkPitchQueryPort = {
  readonly findNetworkPitches: (input: {
    /** The viewer's own organisation: their own videos are not "the network". */
    readonly excludeOwnerOrganisationId: string | null;
    /** Keyset cursor: strictly older than this (createdAt, id). */
    readonly before: {
      readonly createdAt: string;
      readonly mediaAssetId: string;
    } | null;
    readonly limit: number;
  }) => Promise<
    readonly (DiscoverablePitch & { readonly createdAt: string })[]
  >;
};

/** A pitch's stored transcript (R18): one per asset and language, written once. */
export type StoredPitchTranscript = {
  readonly mediaAssetId: MediaAssetId;
  readonly language: string;
  readonly source: "PROVIDER_GENERATED";
  readonly cues: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly text: string;
  }[];
  readonly vtt: string;
  readonly createdAt: string;
};

export type PitchTranscriptRepository = {
  readonly find: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    mediaAssetId: MediaAssetId,
  ) => Promise<StoredPitchTranscript | null>;
  /** Idempotent on (asset, language): a second write keeps the first. */
  readonly insert: (
    tx: TransactionContext,
    input: Omit<StoredPitchTranscript, "createdAt"> & {
      readonly tenantId: TenantId;
    },
  ) => Promise<void>;
  /**
   * Which company owns an asset, in whichever tenant holds it: a lookup
   * only, so a transcript asked for by pitch id can then be authorised by
   * the playback rule for that company. Knowing an id grants nothing.
   */
  readonly findOwnerCompany: (
    executor: DatabaseExecutor,
    mediaAssetId: MediaAssetId,
  ) => Promise<string | null>;
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
  /** R18. Absent: no transcript is ever stored or read (unknown, not empty). */
  readonly pitchTranscripts?: PitchTranscriptRepository | undefined;
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
  /**
   * The company, when it is active and visible to the network (ADR-001
   * network_visible or wider), for any signed-in participant: the gate for
   * a video its owner opened to everyone on Capital Q (audience NETWORK,
   * ADR 0021). It never opens an INVESTORS video. Absent: no such viewer.
   */
  readonly resolveNetworkCompany?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<{
        readonly tenantId: TenantId;
        readonly ownerOrganisationId: OrganisationId;
      } | null>)
    | undefined;
};

export type { OrganisationId };
