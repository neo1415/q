import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * `/v1/companies/:companyId/pitch` — a company's pitch media.
 *
 *   media asset ≠ uploaded video ≠ approved pitch ≠ discoverable company
 *
 * These routes create and read the *record* of a pitch. They transfer no
 * bytes, and creating an asset never means a video was uploaded: the
 * response says CREATED, which is exactly what happened.
 *
 * No response here carries a provider identifier, an upload target, a
 * playback token or a thumbnail reference. Those are integration and
 * authorization material; a client that needs to play media asks for
 * playback separately, and is answered by a later packet.
 */

export const COMPANY_PITCH_SUFFIX = "/pitch" as const;

/** The boundary copy of the Media context's vocabulary, kept identical by test. */
export const MEDIA_PURPOSES = [
  "FOUNDER_PITCH",
  "COMPANY_PRODUCT_DEMO",
  "OTHER",
] as const;
export const MediaPurposeSchema = z.enum(MEDIA_PURPOSES);

export const MEDIA_STATUSES = [
  "CREATED",
  "UPLOAD_PENDING",
  "UPLOADING",
  "PROCESSING",
  "READY",
  "UPLOAD_FAILED",
  "PROCESSING_FAILED",
  "EXPIRED",
  "DELETED",
] as const;
export const MediaStatusSchema = z.enum(MEDIA_STATUSES);

export const PLAYBACK_POLICIES = ["PRIVATE", "AUTHORISED", "PUBLIC"] as const;
export const PlaybackPolicySchema = z.enum(PLAYBACK_POLICIES);

export const MODERATION_STATUSES = [
  "NOT_REVIEWED",
  "PENDING",
  "ALLOWED",
  "BLOCKED",
] as const;
export const ModerationStatusSchema = z.enum(MODERATION_STATUSES);

export const DERIVED_TEXT_STATES = [
  "NOT_REQUESTED",
  "PENDING",
  "AVAILABLE",
  "FAILED",
] as const;
export const DerivedTextStateSchema = z.enum(DERIVED_TEXT_STATES);

/**
 * The create request. Strict and nearly empty on purpose: everything that
 * matters — tenant, owner, provider, status, readiness, moderation, playback
 * policy — is decided by the server. The only thing a client may say is
 * which pitch it believes it is replacing.
 */
export const CreateCompanyPitchRequestSchema = z
  .object({
    replacesMediaAssetId: UuidSchema.optional(),
  })
  .strict();
export type CreateCompanyPitchRequest = z.infer<
  typeof CreateCompanyPitchRequestSchema
>;

export const MediaAssetDtoSchema = z
  .object({
    mediaAssetId: UuidSchema,
    purpose: MediaPurposeSchema,
    status: MediaStatusSchema,
    durationSeconds: z.number().int().nullable(),
    aspectRatio: z.string().nullable(),
    playbackPolicy: PlaybackPolicySchema,
    captionState: DerivedTextStateSchema,
    transcriptState: DerivedTextStateSchema,
    moderationStatus: ModerationStatusSchema,
    replacesMediaAssetId: UuidSchema.nullable(),
    createdAt: UtcTimestampSchema,
    readyAt: UtcTimestampSchema.nullable(),
    version: ResourceVersionSchema,
  })
  .strict();
export type MediaAssetDto = z.infer<typeof MediaAssetDtoSchema>;

export const CompanyPitchResponseSchema = z
  .object({ pitch: MediaAssetDtoSchema.nullable() })
  .strict();
export type CompanyPitchResponse = z.infer<typeof CompanyPitchResponseSchema>;

export const CompanyMediaListResponseSchema = z
  .object({ media: z.array(MediaAssetDtoSchema) })
  .strict();
export type CompanyMediaListResponse = z.infer<
  typeof CompanyMediaListResponseSchema
>;

/**
 * Product guidance for a pitch, served so the client does not hardcode its
 * own copy of tunable numbers. Guidance is not a rule and not a quality
 * measure: a longer or landscape pitch is still a pitch.
 */
export const PitchGuidanceSchema = z
  .object({
    targetMinSeconds: z.number().int().min(1),
    targetMaxSeconds: z.number().int().min(1),
    hardMaxSeconds: z.number().int().min(1),
    preferredAspectRatio: z.string(),
  })
  .strict();
export type PitchGuidance = z.infer<typeof PitchGuidanceSchema>;

export const CreateCompanyPitchResponseSchema = z
  .object({
    pitch: MediaAssetDtoSchema,
    replacedMediaAssetId: UuidSchema.nullable(),
    guidance: PitchGuidanceSchema,
  })
  .strict();
export type CreateCompanyPitchResponse = z.infer<
  typeof CreateCompanyPitchResponseSchema
>;

/*
 * Upload, sync and playback (CQ-MEDIA-010/011). These are the routes the
 * header above said would come later. Each is scoped to one asset under
 * the company's pitch path: `/pitch/:mediaAssetId` + suffix.
 *
 * The provider stays invisible: no route returns a provider identifier,
 * and playback carries no separate token field — whatever authorises the
 * viewer is embedded in the URL the server minted for them.
 */

export const MEDIA_UPLOAD_SESSION_SUFFIX = "/upload-session" as const;
export const MEDIA_SYNC_SUFFIX = "/sync" as const;
export const MEDIA_PLAYBACK_SUFFIX = "/playback" as const;

export const UPLOAD_MODES = ["DIRECT", "RESUMABLE"] as const;
export const UploadModeSchema = z.enum(UPLOAD_MODES);

/**
 * `POST .../pitch/:mediaAssetId/upload-session` — the server reserves a
 * one-time upload target with the provider. The client sends the version
 * it saw so a stale tab cannot reopen an upload on an asset that moved on.
 */
export const CreateMediaUploadSessionRequestSchema = z
  .object({ expectedVersion: ResourceVersionSchema })
  .strict();
export type CreateMediaUploadSessionRequest = z.infer<
  typeof CreateMediaUploadSessionRequestSchema
>;

export const MediaUploadSessionDtoSchema = z
  .object({
    mediaAssetId: UuidSchema,
    uploadMode: UploadModeSchema,
    /** One-time target on the provider's edge: bytes go browser → CDN, never through the API. */
    uploadUrl: z.string().url(),
    expiresAt: UtcTimestampSchema,
    /** The server's reservation; the client may not exceed it. */
    maxDurationSeconds: z.number().int().min(1).max(3600),
    pitch: MediaAssetDtoSchema,
  })
  .strict();
export type MediaUploadSessionDto = z.infer<typeof MediaUploadSessionDtoSchema>;

/**
 * `POST .../pitch/:mediaAssetId/sync` — idempotent "look at the provider
 * and move the lifecycle". Empty body; the answer is the asset as it now is.
 */
export const SyncMediaAssetRequestSchema = z.object({}).strict();
export type SyncMediaAssetRequest = z.infer<typeof SyncMediaAssetRequestSchema>;

export const SyncMediaAssetResponseSchema = z
  .object({ pitch: MediaAssetDtoSchema })
  .strict();
export type SyncMediaAssetResponse = z.infer<
  typeof SyncMediaAssetResponseSchema
>;

/**
 * `POST .../pitch/:mediaAssetId/playback` — per-viewer and short-lived. A
 * provider UID is not access control (doc 20): the viewer is authorised
 * here, server-side, every time.
 */
export const PlaybackAuthorizationDtoSchema = z
  .object({
    mediaAssetId: UuidSchema,
    playbackUrl: z.string().url(),
    posterUrl: z.string().url().nullable(),
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export type PlaybackAuthorizationDto = z.infer<
  typeof PlaybackAuthorizationDtoSchema
>;

/**
 * A company's current pitch as another surface may show it: a feed item,
 * the founder's own company, the network preview an investor opens. Null
 * when none is publishable (READY, moderation ALLOWED, policy not
 * PRIVATE). It carries no provider id and no URL: whoever activates it
 * asks `/playback`, and is authorised there.
 */
export const PitchSummaryDtoSchema = z
  .object({
    mediaAssetId: UuidSchema,
    aspectRatio: z.string().nullable(),
    durationSeconds: z.number().int().nullable(),
    captionState: DerivedTextStateSchema,
  })
  .strict();
export type PitchSummaryDto = z.infer<typeof PitchSummaryDtoSchema>;
