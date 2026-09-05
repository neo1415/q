import { createPostgresMediaRepositories } from "../infrastructure/postgres-media-repository.js";
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
};

export type MediaServiceOptions = Omit<
  MediaServiceDependencies,
  "repositories"
> & {
  readonly repositories?: MediaRepositories | undefined;
};

export function createMediaService(options: MediaServiceOptions): MediaService {
  const dependencies: MediaServiceDependencies = {
    ...options,
    repositories: options.repositories ?? createPostgresMediaRepositories(),
  };
  return {
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
