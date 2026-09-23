import type { VideoProvider } from "../contracts/provider.js";
import { MediaProviderNotConfiguredError } from "../domain/errors.js";

/**
 * The provider a deployment has when it has none (CQ-MEDIA-010).
 *
 * Every call refuses, by name, with the environment variables that would
 * make it work. This exists so the absence of a provider is an explicit
 * object the composition root chose, not an `undefined` that a use case
 * might optional-chain past into a success that never happened.
 */
export const UNCONFIGURED_VIDEO_PROVIDER_ID = "UNCONFIGURED" as const;

export function createUnconfiguredVideoProvider(options: {
  /** Environment variable names an operator must set. Names, never values. */
  readonly missing: readonly string[];
}): VideoProvider {
  return {
    id: UNCONFIGURED_VIDEO_PROVIDER_ID,
    capabilities: {
      directUpload: false,
      resumableUpload: false,
      signedPlayback: false,
      captions: false,
    },
    createUploadSession: () =>
      Promise.reject(
        new MediaProviderNotConfiguredError("upload", options.missing),
      ),
    getAsset: () =>
      Promise.reject(
        new MediaProviderNotConfiguredError("asset status", options.missing),
      ),
    createPlaybackAuthorization: () =>
      Promise.reject(
        new MediaProviderNotConfiguredError("playback", options.missing),
      ),
    deleteAsset: () =>
      Promise.reject(
        new MediaProviderNotConfiguredError("deletion", options.missing),
      ),
  };
}
