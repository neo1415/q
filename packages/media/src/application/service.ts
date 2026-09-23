import type { VideoProviderCapabilities } from "../contracts/provider.js";
import { createPostgresMediaRepositories } from "../infrastructure/postgres-media-repository.js";
import { createUnconfiguredVideoProvider } from "../infrastructure/unconfigured-video-provider.js";
import type { MediaServiceDependencies } from "./dependencies.js";
import {
  createAttachProviderAsset,
  createRecordProviderMetadata,
  createSetMediaStates,
  createTransitionMediaStatus,
} from "./lifecycle-use-cases.js";
import {
  createCreateCompanyPitch,
  createDeleteCompanyPitch,
  createGetCompanyPitch,
  createGetCurrentPitchProjection,
  createListCompanyMedia,
} from "./pitch-use-cases.js";
import type { MediaRepositories, PitchViewerAccessPort } from "./ports.js";
import {
  createAuthorisePlayback,
  createCreateUploadSession,
  createSyncMediaAsset,
} from "./upload-use-cases.js";

/** The Media application surface: bound use cases, nothing else. */
export type MediaService = {
  readonly createCompanyPitch: ReturnType<typeof createCreateCompanyPitch>;
  readonly getCompanyPitch: ReturnType<typeof createGetCompanyPitch>;
  readonly listCompanyMedia: ReturnType<typeof createListCompanyMedia>;
  readonly deleteCompanyPitch: ReturnType<typeof createDeleteCompanyPitch>;
  readonly getCurrentPitchProjection: ReturnType<
    typeof createGetCurrentPitchProjection
  >;
  /**
   * Trusted server operations. Reached by provider adapters and webhook
   * processing in later packets, never by a route a browser can call.
   */
  readonly transitionMediaStatus: ReturnType<
    typeof createTransitionMediaStatus
  >;
  readonly attachProviderAsset: ReturnType<typeof createAttachProviderAsset>;
  readonly recordProviderMetadata: ReturnType<
    typeof createRecordProviderMetadata
  >;
  readonly setMediaStates: ReturnType<typeof createSetMediaStates>;
  /** The direct upload flow (CQ-MEDIA-011): reserve, sync, play. */
  readonly createUploadSession: ReturnType<typeof createCreateUploadSession>;
  readonly syncMediaAsset: ReturnType<typeof createSyncMediaAsset>;
  readonly authorisePlayback: ReturnType<typeof createAuthorisePlayback>;
  /**
   * Which provider this deployment composed and what it can do. Names and
   * booleans only — safe for a health line, useless to an attacker.
   */
  readonly provider: {
    readonly id: string;
    readonly capabilities: VideoProviderCapabilities;
  };
};

export type MediaServiceOptions = Omit<
  MediaServiceDependencies,
  "repositories" | "videoProvider" | "viewers"
> & {
  readonly repositories?: MediaRepositories | undefined;
  /** Absent means the explicit unconfigured provider, which refuses by name. */
  readonly videoProvider?:
    MediaServiceDependencies["videoProvider"] | undefined;
  /** Absent means nobody but the owner may ever play a pitch. */
  readonly viewers?: PitchViewerAccessPort | undefined;
};

/** The viewer port of a deployment that composed none: no viewer, ever. */
export const NO_PITCH_VIEWERS: PitchViewerAccessPort = {
  resolveViewableCompany: () => Promise.resolve(null),
};

export function createMediaService(options: MediaServiceOptions): MediaService {
  const dependencies: MediaServiceDependencies = {
    ...options,
    repositories: options.repositories ?? createPostgresMediaRepositories(),
    videoProvider:
      options.videoProvider ??
      createUnconfiguredVideoProvider({
        missing: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_STREAM_API_TOKEN"],
      }),
    viewers: options.viewers ?? NO_PITCH_VIEWERS,
  };
  return {
    provider: {
      id: dependencies.videoProvider.id,
      capabilities: dependencies.videoProvider.capabilities,
    },
    createCompanyPitch: createCreateCompanyPitch(dependencies),
    getCompanyPitch: createGetCompanyPitch(dependencies),
    listCompanyMedia: createListCompanyMedia(dependencies),
    deleteCompanyPitch: createDeleteCompanyPitch(dependencies),
    getCurrentPitchProjection: createGetCurrentPitchProjection(dependencies),
    transitionMediaStatus: createTransitionMediaStatus(dependencies),
    attachProviderAsset: createAttachProviderAsset(dependencies),
    recordProviderMetadata: createRecordProviderMetadata(dependencies),
    setMediaStates: createSetMediaStates(dependencies),
    createUploadSession: createCreateUploadSession(dependencies),
    syncMediaAsset: createSyncMediaAsset(dependencies),
    authorisePlayback: createAuthorisePlayback(dependencies),
  };
}
