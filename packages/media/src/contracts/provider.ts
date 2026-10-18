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

/** A SHA-256 hex digest. Hashes only ever cross this boundary, never keys. */
export const ReservationKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected a reservation digest");

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
    /**
     * The file's exact size, when the creator's client can resume. Its
     * presence asks for a RESUMABLE target: a resumable protocol fixes the
     * length up front so an interrupted transfer knows where it stands.
     * Absent means the one-shot DIRECT target.
     */
    uploadLengthBytes: z.number().int().min(1).optional(),
    /**
     * A server-derived digest (never the client's raw key) that the provider
     * keeps with the asset, so a retried reservation can be recognised as
     * the same request and answered with the same target.
     */
    reservationKey: ReservationKeySchema.optional(),
  })
  .strict();
export type CreateVideoUploadSession = z.infer<
  typeof CreateVideoUploadSessionSchema
>;

export const UPLOAD_MODES = ["DIRECT", "RESUMABLE"] as const;
export const UploadModeSchema = z.enum(UPLOAD_MODES);
export type UploadMode = z.infer<typeof UploadModeSchema>;

/**
 * A target the creator's browser uploads to directly. It is handed over and
 * never persisted by Capital Q: it authorises a transfer into one asset,
 * and a transfer is not a permission to do anything else.
 */
export const VideoUploadSessionSchema = z
  .object({
    providerAssetId: ProviderAssetIdSchema,
    uploadMode: UploadModeSchema,
    uploadUrl: z.string().url(),
    expiresAt: z.string().optional(),
    /**
     * RESUMABLE only: the size each transfer request should carry. A
     * provider fact (its minimum and alignment), so it travels with the
     * target rather than being known by the browser.
     */
    chunkSizeBytes: z.number().int().min(1).optional(),
  })
  .strict();
export type VideoUploadSession = z.infer<typeof VideoUploadSessionSchema>;

/**
 * "Is the resumable target this request reserved still open?" Answered from
 * the provider's own record: the asset must carry our media asset id and
 * the same reservation key, and still be waiting for bytes. Anything else
 * is null — a retry does not get a target it did not reserve.
 */
export const ResumeVideoUploadSessionSchema = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    providerAssetId: ProviderAssetIdSchema,
    reservationKey: ReservationKeySchema,
  })
  .strict();
export type ResumeVideoUploadSession = z.infer<
  typeof ResumeVideoUploadSessionSchema
>;

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
    /** The poster frame, under the same grant, when the provider serves one. */
    posterUrl: z.string().url().optional(),
    expiresAt: z.string(),
  })
  .strict();
export type PlaybackAuthorization = z.infer<typeof PlaybackAuthorizationSchema>;

/**
 * Permission to save one pitch as a file (ADR 0047). Reaching this point
 * means Capital Q has already decided this viewer may watch it AND that its
 * owner allows downloads; the provider only turns that into a short-lived
 * link that the browser fetches from the CDN directly.
 */
export const DownloadAuthorizationRequestSchema = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    providerAssetId: ProviderAssetIdSchema,
    accessMode: PlaybackPolicySchema,
    ttlSeconds: z.number().int().min(30).max(3_600),
    /** The saved file's name, already reduced to safe characters. */
    fileName: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/u),
  })
  .strict();
export type DownloadAuthorizationRequest = z.infer<
  typeof DownloadAuthorizationRequestSchema
>;

/**
 * READY: a link to the file, valid until `expiresAt`. PREPARING: the
 * provider is still making the file (first request for this pitch).
 * The link is a short-lived secret, like a playback token: never logged,
 * stored, or put in an event or audit record.
 */
export type DownloadAuthorization =
  | {
      readonly status: "READY";
      readonly mediaAssetId: MediaAssetId;
      readonly downloadUrl: string;
      readonly expiresAt: string;
    }
  | {
      readonly status: "PREPARING";
      readonly mediaAssetId: MediaAssetId;
      readonly percentComplete: number | null;
    };

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export type VideoProvider = {
  readonly id: string;
  readonly capabilities: VideoProviderCapabilities;
  readonly createUploadSession: (
    input: CreateVideoUploadSession,
  ) => Promise<VideoUploadSession>;
  /** The same open RESUMABLE target again, or null. Never a new one. */
  readonly resumeUploadSession: (
    input: ResumeVideoUploadSession,
  ) => Promise<VideoUploadSession | null>;
  readonly getAsset: (providerAssetId: string) => Promise<VideoAssetStatus>;
  readonly createPlaybackAuthorization: (
    input: PlaybackAuthorizationRequest,
  ) => Promise<PlaybackAuthorization>;
  /**
   * ADR 0047: a short-lived link to the pitch as a file. Idempotent: asking
   * again while the file is being made answers PREPARING. Absent when the
   * provider cannot serve downloads.
   */
  readonly createDownloadAuthorization?:
    | ((input: DownloadAuthorizationRequest) => Promise<DownloadAuthorization>)
    | undefined;
  /** Idempotent: deleting an asset the provider no longer has is success. */
  readonly deleteAsset: (providerAssetId: string) => Promise<void>;
  /**
   * Ask the provider to generate captions for a READY asset in one
   * language (R18). Idempotent: asking again for a language it already
   * has, or is making, answers its current state. Present only when
   * `capabilities.captions` is true.
   */
  readonly requestGeneratedCaptions?:
    | ((
        providerAssetId: string,
        language: string,
      ) => Promise<GeneratedCaptionsStatus>)
    | undefined;
  /** The generated captions in one language, with the WebVTT once READY. */
  readonly getGeneratedCaptions?:
    | ((
        providerAssetId: string,
        language: string,
      ) => Promise<GeneratedCaptions>)
    | undefined;
};

/**
 * Generated captions, as the provider reports them. NONE: never asked for
 * in that language. Nothing here is a transcript until it is READY.
 */
export type GeneratedCaptionsStatus = "NONE" | "PENDING" | "READY" | "FAILED";
export type GeneratedCaptions =
  | { readonly status: "NONE" | "PENDING" | "FAILED" }
  | { readonly status: "READY"; readonly vtt: string };

/** Re-exported so an adapter needs one import for the whole boundary. */
export type { MediaAssetId, MediaPurpose, MediaStatus, PlaybackPolicy };
