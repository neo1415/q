import { z } from "zod";

import {
  MediaAssetIdSchema,
  MediaPurposeSchema,
  MediaStatusSchema,
  PlaybackPolicySchema,
  ProviderAssetIdSchema,
  type MediaAssetId,
  type MediaPurpose,
  type MediaStatus,
  type PlaybackPolicy,
} from "./index.js";

/**
 * The video provider boundary (doc 20 §5, doc 22 §140).
 *
 * Every name here is Capital Q's. No vendor type, no vendor field name and
 * no vendor status string appears in this file or anywhere the product
 * imports it, because the point of the abstraction is that replacing the
 * provider does not reach into company profile, discovery, recommendation
 * or analytics.
 *
 * Nothing implements this yet. `CQ-MEDIA-010` writes the first adapter and
 * must be able to do so without changing this file, the schema, or any
 * consuming domain — that is the test of whether the seam is real.
 */

/**
 * What a provider can actually do. Adapters differ, and a product that
 * assumes otherwise degrades badly: a provider without signed playback is a
 * provider Capital Q must not use for AUTHORISED media, and it should say
 * so rather than silently serving an open URL.
 */
export type VideoProviderCapabilities = {
  readonly directUpload: boolean;
  readonly resumableUpload: boolean;
  readonly signedPlayback: boolean;
  readonly captions: boolean;
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * The server's instruction to reserve an upload. Every constraint is chosen
 * here, not by the browser: a client that could set its own duration
 * allowance or drop the signed-playback requirement would be setting Capital
 * Q's cost and security policy.
 */
export const CreateVideoUploadSessionSchema = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    purpose: MediaPurposeSchema,
    /**
     * Providers reserve storage against this until the upload completes or
     * expires, so it is a cost and abuse control, not a hint.
     */
    maxDurationSeconds: z.number().int().min(1).max(3_600),
    requireSignedPlayback: z.boolean(),
    /** Restricts where the upload target may be used from, when supported. */
    allowedOrigin: z.string().url().optional(),
  })
  .strict();
export type CreateVideoUploadSession = z.infer<
  typeof CreateVideoUploadSessionSchema
>;

export const UPLOAD_MODES = ["DIRECT", "RESUMABLE"] as const;
export const UploadModeSchema = z.enum(UPLOAD_MODES);
export type UploadMode = z.infer<typeof UploadModeSchema>;

/**
 * A one-time target the creator's browser uploads to directly. It is handed
 * over once and never persisted: it authorises a transfer, and a transfer is
 * not a permission to do anything else.
 */
export const VideoUploadSessionSchema = z
  .object({
    providerAssetId: ProviderAssetIdSchema,
    uploadMode: UploadModeSchema,
    uploadUrl: z.string().url(),
    expiresAt: z.string().optional(),
  })
  .strict();
export type VideoUploadSession = z.infer<typeof VideoUploadSessionSchema>;

// ---------------------------------------------------------------------------
// Asset status
// ---------------------------------------------------------------------------

/**
 * A provider's view of one asset, already normalised into Capital Q's
 * lifecycle by the adapter. The raw vendor status never travels further
 * than the adapter that read it.
 */
export const VideoAssetStatusSchema = z
  .object({
    providerAssetId: ProviderAssetIdSchema,
    status: MediaStatusSchema,
    durationSeconds: z.number().int().min(1).max(86_400).optional(),
    width: z.number().int().min(1).max(16_384).optional(),
    height: z.number().int().min(1).max(16_384).optional(),
    thumbnailReference: z.string().min(1).max(255).optional(),
    /** The provider's own failure code, for private diagnostics only. */
    providerErrorCode: z.string().min(1).max(64).optional(),
  })
  .strict();
export type VideoAssetStatus = z.infer<typeof VideoAssetStatusSchema>;

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/**
 * A request for the provider to permit one playback.
 *
 * Reaching this point means Capital Q has already decided the viewer may
 * watch: authorization, disclosure, playback policy and asset readiness are
 * resolved before the provider is asked for anything. Knowing a
 * providerAssetId is not, and must never become, a way to play media.
 */
export const PlaybackAuthorizationRequestSchema = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    providerAssetId: ProviderAssetIdSchema,
    accessMode: PlaybackPolicySchema,
    /** Upper bound on how long the granted playback stays valid. */
    ttlSeconds: z.number().int().min(30).max(86_400),
  })
  .strict();
export type PlaybackAuthorizationRequest = z.infer<
  typeof PlaybackAuthorizationRequestSchema
>;

/**
 * Provider-neutral permission to play. The token is a short-lived secret:
 * it is handed to one viewer, never logged, never stored and never placed in
 * an event or an audit record.
 */
export const PlaybackAuthorizationSchema = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    /** Opaque provider grant, if the provider issues one. */
    token: z.string().min(1).optional(),
    playbackUrl: z.string().url(),
    expiresAt: z.string(),
  })
  .strict();
export type PlaybackAuthorization = z.infer<typeof PlaybackAuthorizationSchema>;

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export type VideoProvider = {
  readonly id: string;
  readonly capabilities: VideoProviderCapabilities;
  readonly createUploadSession: (
    input: CreateVideoUploadSession,
  ) => Promise<VideoUploadSession>;
  readonly getAsset: (providerAssetId: string) => Promise<VideoAssetStatus>;
  readonly createPlaybackAuthorization: (
    input: PlaybackAuthorizationRequest,
  ) => Promise<PlaybackAuthorization>;
  /** Idempotent: deleting an asset the provider no longer has is success. */
  readonly deleteAsset: (providerAssetId: string) => Promise<void>;
};

/** Re-exported so an adapter needs one import for the whole boundary. */
export type { MediaAssetId, MediaPurpose, MediaStatus, PlaybackPolicy };
