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
