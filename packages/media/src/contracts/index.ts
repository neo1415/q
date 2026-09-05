import { z } from "zod";

import {
  createUuidIdSchema,
  UuidSchema,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

/**
 * The Media context's vocabulary (doc 20 §5–8, §14, §99–100).
 *
 *   MediaAsset ≠ provider asset
 *   media READY ≠ company discoverable ≠ pitch approved
 *   encoding status ≠ moderation status
 *   video quality ≠ investment quality
 *
 * A MediaAsset is Capital Q's canonical record of a piece of pitch media:
 * who owns it, what it is for, where it is in its lifecycle, and — once a
 * provider exists — which external asset holds the bytes. The provider's
 * identifier is replaceable integration metadata; it is never this record's
 * identity and never a permission.
 */

export const MediaAssetIdSchema = createUuidIdSchema("MediaAssetId");
export type MediaAssetId = z.infer<typeof MediaAssetIdSchema>;

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Bounded owner types. Polymorphic in the same way `evidence.evidence_items`
 * is: a small closed set resolved through a typed registry, never a table
 * name interpolated into a query.
 */
export const MEDIA_OWNER_TYPES = ["COMPANY"] as const;
export const MediaOwnerTypeSchema = z.enum(MEDIA_OWNER_TYPES);
export type MediaOwnerType = z.infer<typeof MediaOwnerTypeSchema>;

export const MediaOwnerRefSchema = z
  .object({ ownerType: MediaOwnerTypeSchema, ownerId: UuidSchema })
  .strict();
export type MediaOwnerRef = z.infer<typeof MediaOwnerRefSchema>;

// ---------------------------------------------------------------------------
// Purpose
// ---------------------------------------------------------------------------

/**
 * What the media is for. Policy differs by purpose, which is why this is a
 * field rather than an assumption: a founder pitch is made to be shown to
 * investors, and its rules must never be inherited by a recording of a
 * private conversation. `MEETING_RECORDING` is deliberately absent — it
 * needs consent, retention and disclosure rules this packet does not have.
 */
export const MEDIA_PURPOSES = [
  "FOUNDER_PITCH",
  "COMPANY_PRODUCT_DEMO",
  "OTHER",
] as const;
export const MediaPurposeSchema = z.enum(MEDIA_PURPOSES);
export type MediaPurpose = z.infer<typeof MediaPurposeSchema>;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Which external service holds the bytes. `UNASSIGNED` is the honest state
 * for an asset created before any provider integration exists: there is no
 * external asset, and inventing a fake identifier to fill the column would
 * make the record lie.
 */
export const MEDIA_PROVIDERS = ["UNASSIGNED", "CLOUDFLARE_STREAM"] as const;
export const MediaProviderSchema = z.enum(MEDIA_PROVIDERS);
export type MediaProvider = z.infer<typeof MediaProviderSchema>;

/** Opaque to Capital Q. Bounded so a provider cannot hand us a payload. */
export const ProviderAssetIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Capital Q's own lifecycle (doc 20 §14), not a mirror of vendor states. A
 * provider's raw status is normalised into this by the adapter that speaks
 * to it, so replacing the provider never changes what the product means.
 */
export const MEDIA_STATUSES = [
  /** The logical asset exists. Nothing has been uploaded. */
  "CREATED",
  /** A provider upload target has been reserved and is waiting for bytes. */
  "UPLOAD_PENDING",
  "UPLOADING",
  "PROCESSING",
  /** The provider reports the media sufficiently processed to play. */
  "READY",
  "UPLOAD_FAILED",
  "PROCESSING_FAILED",
  /** The upload target expired before any bytes arrived. */
  "EXPIRED",
  "DELETED",
] as const;
export const MediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

// ---------------------------------------------------------------------------
// Playback, moderation, captions, transcript — four independent axes
// ---------------------------------------------------------------------------

/**
 * How playback may ever be granted. Not a DisclosureScope: this says what
 * kind of authorization the media itself demands, while disclosure decides
 * whether this particular viewer may see this particular company's material.
 * Both must be satisfied, and neither substitutes for the other.
 */
export const PLAYBACK_POLICIES = [
  /** The owning context only. Nothing outside it may ever be authorised. */
  "PRIVATE",
  /** Capital Q must authorise each playback against the viewer. */
  "AUTHORISED",
  /** Eligible for deliberate public playback. Eligible is not published. */
  "PUBLIC",
] as const;
export const PlaybackPolicySchema = z.enum(PLAYBACK_POLICIES);
export type PlaybackPolicy = z.infer<typeof PlaybackPolicySchema>;

/**
 * Separate from lifecycle on purpose: a provider can encode a video
 * perfectly that Capital Q must not show. READY says the bytes are
 * playable; only ALLOWED says the content passed review.
 */
export const MODERATION_STATUSES = [
  "NOT_REVIEWED",
  "PENDING",
  "ALLOWED",
  "BLOCKED",
] as const;
export const ModerationStatusSchema = z.enum(MODERATION_STATUSES);
export type ModerationStatus = z.infer<typeof ModerationStatusSchema>;

/** Caption and transcript lifecycles. Nothing generates either yet. */
export const DERIVED_TEXT_STATES = [
  "NOT_REQUESTED",
  "PENDING",
  "AVAILABLE",
  "FAILED",
] as const;
export const CaptionStateSchema = z.enum(DERIVED_TEXT_STATES);
export type CaptionState = z.infer<typeof CaptionStateSchema>;
export const TranscriptStateSchema = z.enum(DERIVED_TEXT_STATES);
export type TranscriptState = z.infer<typeof TranscriptStateSchema>;

// ---------------------------------------------------------------------------
// Technical metadata
// ---------------------------------------------------------------------------

/**
 * Provider-normalised facts about the file. They describe a video; they say
 * nothing about a company. Resolution, orientation and framing must never
 * become inputs to fit, ranking or assessment.
 */
export const AspectRatioSchema = z.string().regex(/^\d{1,3}:\d{1,3}$/);

export const MediaTechnicalMetadataSchema = z
  .object({
    durationSeconds: z.number().int().min(1).max(86_400).optional(),
    width: z.number().int().min(1).max(16_384).optional(),
    height: z.number().int().min(1).max(16_384).optional(),
    aspectRatio: AspectRatioSchema.optional(),
    /**
     * A provider or storage reference for the poster image. Never a URL a
     * client supplied, and never bytes.
     */
    thumbnailReference: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_.:-]*$/)
      .optional(),
  })
  .strict();
export type MediaTechnicalMetadata = z.infer<
  typeof MediaTechnicalMetadataSchema
>;

/**
 * Product-tunable pitch duration guidance (doc 20 §8), in one place so it
 * never gets copied into a database constraint, a UI string and a validator
 * that then drift apart. It is guidance about product fit, not a security
 * bound and not a quality judgement.
 */
export type MediaDurationPolicy = {
  readonly targetMinSeconds: number;
  readonly targetMaxSeconds: number;
  readonly hardMaxSeconds: number;
};

export const DEFAULT_PITCH_DURATION_POLICY: MediaDurationPolicy = {
  targetMinSeconds: 30,
  targetMaxSeconds: 120,
  hardMaxSeconds: 180,
};

/** Guidance only. A landscape pitch is a pitch. */
export const PREFERRED_PITCH_ASPECT_RATIO = "9:16" as const;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export type MediaAsset = {
  readonly id: MediaAssetId;
  readonly tenantId: TenantId;
  readonly ownerType: MediaOwnerType;
  readonly ownerId: string;
  /** The organisation accountable for the owning resource. */
  readonly ownerOrganisationId: OrganisationId;
  readonly purpose: MediaPurpose;
  readonly provider: MediaProvider;
  /** Integration metadata. Never identity, never authorization. */
  readonly providerAssetId: string | null;
  readonly status: MediaStatus;
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly aspectRatio: string | null;
  readonly playbackPolicy: PlaybackPolicy;
  readonly thumbnailReference: string | null;
  readonly captionState: CaptionState;
  readonly transcriptState: TranscriptState;
  readonly moderationStatus: ModerationStatus;
  /** Lineage: the asset this one replaced. Replacement never overwrites. */
  readonly replacesMediaAssetId: MediaAssetId | null;
  /** Set when a successor replaced this asset. Superseded is not deleted. */
  readonly supersededAt: UtcTimestamp | null;
  readonly createdByUserId: UserId;
  readonly createdAt: UtcTimestamp;
  readonly readyAt: UtcTimestamp | null;
  readonly deletedAt: UtcTimestamp | null;
  /** Optimistic concurrency: a stale writer never wins. */
  readonly version: number;
};

export type NewMediaAsset = {
  readonly tenantId: TenantId;
  readonly ownerType: MediaOwnerType;
  readonly ownerId: string;
  readonly ownerOrganisationId: OrganisationId;
  readonly purpose: MediaPurpose;
  readonly playbackPolicy: PlaybackPolicy;
  readonly createdByUserId: UserId;
  readonly replacesMediaAssetId?: MediaAssetId | undefined;
};

/**
 * What a client may see. No provider identifier, no upload target, no
 * playback token, no storage reference: those are integration and
 * authorization material, and a viewer never needs them to know what the
 * pitch is or where it stands.
 */
export type MediaAssetDto = {
  readonly mediaAssetId: string;
  readonly purpose: MediaPurpose;
  readonly status: MediaStatus;
  readonly durationSeconds: number | null;
  readonly aspectRatio: string | null;
  readonly playbackPolicy: PlaybackPolicy;
  readonly captionState: CaptionState;
  readonly transcriptState: TranscriptState;
  readonly moderationStatus: ModerationStatus;
  readonly replacesMediaAssetId: string | null;
  readonly createdAt: string;
  readonly readyAt: string | null;
  readonly version: number;
};

export function toMediaAssetDto(asset: MediaAsset): MediaAssetDto {
  return {
    mediaAssetId: asset.id,
    purpose: asset.purpose,
    status: asset.status,
    durationSeconds: asset.durationSeconds,
    aspectRatio: asset.aspectRatio,
    playbackPolicy: asset.playbackPolicy,
    captionState: asset.captionState,
    transcriptState: asset.transcriptState,
    moderationStatus: asset.moderationStatus,
    replacesMediaAssetId: asset.replacesMediaAssetId,
    createdAt: asset.createdAt,
    readyAt: asset.readyAt,
    version: asset.version,
  };
}

/**
 * What a later consumer — company profile, discovery projection, Q — needs
 * to know about a company's current pitch, without reading media SQL.
 * Deliberately thin: it says the pitch exists and where it stands, never
 * whether the company is good.
 */
export type CompanyPitch = {
  readonly mediaAssetId: MediaAssetId;
  readonly companyId: string;
  readonly status: MediaStatus;
  readonly playbackPolicy: PlaybackPolicy;
  readonly moderationStatus: ModerationStatus;
  readonly captionState: CaptionState;
  readonly transcriptState: TranscriptState;
  readonly durationSeconds: number | null;
  readonly aspectRatio: string | null;
  readonly readyAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
};

export function toCompanyPitch(asset: MediaAsset): CompanyPitch {
  return {
    mediaAssetId: asset.id,
    companyId: asset.ownerId,
    status: asset.status,
    playbackPolicy: asset.playbackPolicy,
    moderationStatus: asset.moderationStatus,
    captionState: asset.captionState,
    transcriptState: asset.transcriptState,
    durationSeconds: asset.durationSeconds,
    aspectRatio: asset.aspectRatio,
    readyAt: asset.readyAt,
    createdAt: asset.createdAt,
  };
}

/**
 * Whether a pitch may be offered for playback at all, before any viewer is
 * considered. Every condition is separate and every one is necessary; a
 * READY video is not a publishable pitch on its own (doc 20 §100).
 */
export function isPitchPlayable(pitch: CompanyPitch): boolean {
  return (
    pitch.status === "READY" &&
    pitch.moderationStatus === "ALLOWED" &&
    pitch.playbackPolicy !== "PRIVATE"
  );
}
