/**
 * @capital-q/media
 *
 * Owns: the canonical record of a piece of pitch media — who owns it, what
 * it is for, where it stands in Capital Q's lifecycle, how playback may be
 * authorised, what review decided, whether captions or a transcript exist,
 * and which asset it replaced (schema `media`).
 *
 * Does not own: companies, recommendation, the feed, the player, Q, evidence
 * claims, transcript intelligence, or the bytes. A managed provider stores
 * and delivers the video; PostgreSQL holds metadata and lifecycle only.
 *
 *   MediaAsset ≠ provider asset ≠ Company
 *   media READY ≠ company discoverable ≠ pitch approved
 *   encoding status ≠ moderation status
 *   video quality ≠ investment quality
 *
 * One provider is implemented, behind the `VideoProvider` port: Cloudflare
 * Stream (CQ-MEDIA-010). Its vocabulary stops at its adapter file; the
 * credential is revealed once at composition and appears nowhere else. A
 * deployment without one holds the explicit unconfigured provider, which
 * refuses every call by naming what is missing.
 *
 * Server-side only.
 */

export * from "./contracts/index.js";
export * from "./contracts/provider.js";

export {
  MEDIA_PROVIDER_FAILURES,
  MediaAssetConflictError,
  MediaAssetNotFoundError,
  MediaIdempotencyConflictError,
  MediaOwnerNotFoundError,
  MediaProviderError,
  MediaProviderNotConfiguredError,
  MediaReplacementConflictError,
  MediaRuleError,
  MediaTransitionError,
  type MediaProviderFailure,
} from "./domain/errors.js";
export {
  MAX_PITCH_UPLOAD_BYTES,
  uploadReservationKey,
} from "./domain/upload-reservation.js";
export {
  allowedTransitionsFrom,
  canTransition,
  isReady,
  isTerminal,
  isUnusable,
  transitionPath,
} from "./domain/lifecycle.js";
export {
  createCompanyMediaOwnerResolver,
  createMediaOwnerResolverRegistry,
  type MediaOwnerResolver,
  type MediaOwnerResolverRegistry,
  type ResolvedMediaOwner,
} from "./domain/owners.js";

export {
  MEDIA_CREATE,
  MEDIA_MANAGE,
  MEDIA_VIEW,
} from "./application/authority.js";
export type { MediaServiceDependencies } from "./application/dependencies.js";
export type {
  CompanyPitchQueryPort,
  DiscoverablePitchQueryPort,
  NetworkPitchQueryPort,
  MediaAssetRepository,
  MediaRepositories,
  PitchTranscriptRepository,
  PitchRequestStore,
  PitchViewerAccessPort,
  StoredPitchTranscript,
} from "./application/ports.js";
export {
  AUTOMATED_MODERATION_RULE_V1,
  evaluateAutomatedModeration,
  MODERATION_HOLD_REASONS,
  type AutomatedModerationRule,
  type ModerationHoldReason,
  type ModerationVerdict,
} from "./domain/moderation.js";
export {
  createApplyAutomatedModeration,
  createPostgresAutomatedModeration,
  createSetPitchDetails,
  createSetPitchDownloadable,
  createSetPitchPlaybackPolicy,
  OwnerPlaybackPolicySchema,
  PitchDetailsSchema,
  type PitchDetails,
  type SetPitchDetailsCommand,
  type SetPitchDownloadableCommand,
  type ApplyAutomatedModerationCommand,
  type AutomatedModerationDependencies,
  type AutomatedModerationResult,
  type OwnerPlaybackPolicy,
  type SetPitchPlaybackPolicyCommand,
} from "./application/publish-use-cases.js";
export {
  aspectRatioOf,
  planProviderReport,
  type ProviderReportPlan,
} from "./application/provider-report.js";
export {
  createApplyProviderStatusReport,
  type ApplyProviderStatusReportCommand,
  type ProviderStatusDependencies,
  type ProviderStatusReportOutcome,
} from "./application/provider-status-use-cases.js";
export {
  createGetPitchTranscript,
  createGetPitchTranscriptByPitch,
  createMayPlayPitch,
  createSweepPitchCaptions,
  createSyncPitchTranscript,
  PITCH_TRANSCRIPT_LANGUAGE,
  type PitchTranscriptView,
  type SweepPitchCaptionsResult,
  type SyncPitchTranscriptOutcome,
} from "./application/transcript-use-cases.js";
export {
  extractPitchClaims,
  firstPitchRaise,
  moneyIn,
  pitchMomentLabel,
  PITCH_CLAIMS_READER_VERSION,
  type PitchClaim,
  type PitchClaimKind,
} from "./domain/pitch-claims.js";
export {
  cuesAround,
  parseWebVtt,
  WEB_VTT_MAX_CUES,
  type TimedCue,
} from "./domain/web-vtt.js";
export {
  downloadFileName,
  type AuthoriseDownloadQuery,
  type AuthorisePlaybackQuery,
  type CancelUploadCommand,
  type CancelUploadResult,
  type CreateUploadSessionCommand,
  type PlaybackGrant,
  type SyncMediaAssetCommand,
  type UploadSessionResult,
} from "./application/upload-use-cases.js";
export {
  CreateCompanyPitchInputSchema,
  hashPitchIdempotencyKey,
  type CompanyPitchResult,
  type CreateCompanyPitchCommand,
  type CreateCompanyPitchInput,
  type DeleteCompanyPitchCommand,
  type GetCompanyPitchQuery,
} from "./application/pitch-use-cases.js";
export {
  AttachProviderAssetInputSchema,
  RecordProviderMetadataInputSchema,
  SetMediaStatesInputSchema,
  TransitionMediaStatusInputSchema,
  type AttachProviderAssetInput,
  type RecordProviderMetadataInput,
  type SetMediaStatesInput,
  type TransitionMediaStatusInput,
} from "./application/lifecycle-use-cases.js";
export {
  createMediaService,
  NO_PITCH_VIEWERS,
  type MediaService,
  type MediaServiceOptions,
} from "./application/service.js";

export {
  createPostgresCompanyPitchQueryPort,
  createPostgresDiscoverablePitchQueryPort,
  createPostgresNetworkPitchQueryPort,
  NETWORK_PITCH_PAGE_MAX,
  createPostgresMediaAssetRepository,
  createPostgresMediaRepositories,
  createPostgresPitchTranscriptRepository,
  createPostgresPitchRequestStore,
} from "./infrastructure/postgres-media-repository.js";
export {
  CLOUDFLARE_STREAM_PROVIDER_ID,
  CLOUDFLARE_TUS_CHUNK_SIZE_BYTES,
  classifyCloudflareStatus,
  createCloudflareStreamVideoProvider,
  normalizeCloudflareVideo,
  translateCloudflareState,
  type CloudflareStreamSigningKey,
  type CloudflareStreamVideoProviderOptions,
} from "./infrastructure/cloudflare-stream-video-provider.js";
export {
  CLOUDFLARE_STREAM_WEBHOOK_SIGNATURE_HEADER,
  CLOUDFLARE_STREAM_WEBHOOK_TOLERANCE_SECONDS,
  readCloudflareStreamWebhook,
  verifyCloudflareStreamWebhookSignature,
  type CloudflareStreamWebhookReading,
  type WebhookSignatureRefusal,
  type WebhookSignatureVerdict,
} from "./infrastructure/cloudflare-stream-webhook.js";
export {
  UNCONFIGURED_VIDEO_PROVIDER_ID,
  createUnconfiguredVideoProvider,
} from "./infrastructure/unconfigured-video-provider.js";

export const PACKAGE_NAME = "@capital-q/media" as const;
