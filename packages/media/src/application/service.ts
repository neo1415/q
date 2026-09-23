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
import type { MediaRepositories } from "./ports.js";

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
  "repositories" | "videoProvider"
> & {
  readonly repositories?: MediaRepositories | undefined;
  /** Absent means the explicit unconfigured provider, which refuses by name. */
  readonly videoProvider?:
    MediaServiceDependencies["videoProvider"] | undefined;
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
  };
}
