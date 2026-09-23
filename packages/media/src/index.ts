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
  MediaOwnerNotFoundError,
  MediaProviderError,
  MediaProviderNotConfiguredError,
  MediaReplacementConflictError,
  MediaRuleError,
  MediaTransitionError,
  type MediaProviderFailure,
} from "./domain/errors.js";
export {
  allowedTransitionsFrom,
  canTransition,
  isReady,
  isTerminal,
  isUnusable,
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
  MediaAssetRepository,
  MediaRepositories,
} from "./application/ports.js";
export {
  CreateCompanyPitchInputSchema,
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
  type MediaService,
  type MediaServiceOptions,
} from "./application/service.js";

export {
  createPostgresCompanyPitchQueryPort,
  createPostgresMediaAssetRepository,
  createPostgresMediaRepositories,
} from "./infrastructure/postgres-media-repository.js";
export {
  CLOUDFLARE_STREAM_PROVIDER_ID,
  classifyCloudflareStatus,
  createCloudflareStreamVideoProvider,
  translateCloudflareState,
  type CloudflareStreamSigningKey,
  type CloudflareStreamVideoProviderOptions,
} from "./infrastructure/cloudflare-stream-video-provider.js";
export {
  UNCONFIGURED_VIDEO_PROVIDER_ID,
  createUnconfiguredVideoProvider,
} from "./infrastructure/unconfigured-video-provider.js";

export const PACKAGE_NAME = "@capital-q/media" as const;
