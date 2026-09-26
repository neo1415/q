import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import {
  isPlaybackUsable,
  type PlaybackSource,
} from "../player/pitch-playback";

/**
 * One feed's playback authorizations (spec §9.5; doc 20 §50).
 *
 * The feed recycles three players and warms a poster for the card after
 * next, so the same company's authorization is wanted by more than one
 * element over a few swipes: the poster warmer two cards ahead, then the
 * slot that buffers it, then the slot that plays it, and again when the
 * reader goes back. Without one owner each of those asked the server
 * again, and the warmed poster was fetched under a URL the player then
 * replaced.
 *
 * What is held is exactly what the server granted this viewer for one
 * company's one asset, kept only while it is usable (the same expiry
 * margin the player applies). A refusal is never held -- the next ask
 * asks again, and the server decides again. Nothing is persisted: the
 * cache lives and dies with the feed on screen.
 */

export type AuthorisePlayback = (
  companyId: string,
  mediaAssetId: string,
) => Promise<PlaybackAuthorizationDto>;

export type FeedPlaybackAuthorizations = {
  /** A stable source per company, for `usePitchPlayback`. */
  readonly sourceFor: (companyId: string) => PlaybackSource;
};

export function feedPlaybackAuthorizations(
  authorise: AuthorisePlayback,
  options: {
    /** What the server read for the first card while rendering the page. */
    readonly seed?: {
      readonly companyId: string;
      readonly authorization: PlaybackAuthorizationDto;
    } | null;
    readonly now?: () => number;
  } = {},
): FeedPlaybackAuthorizations {
  const now = options.now ?? Date.now;
  const held = new Map<string, PlaybackAuthorizationDto>();
  const inFlight = new Map<string, Promise<PlaybackAuthorizationDto>>();
  const sources = new Map<string, PlaybackSource>();

  // Company and asset together: an authorization answers "may this viewer
  // watch this company's pitch", so an asset id alone is not the question.
  const keyOf = (companyId: string, mediaAssetId: string) =>
    `${companyId}\u0000${mediaAssetId}`;

  const seed = options.seed ?? null;
  if (seed !== null) {
    held.set(
      keyOf(seed.companyId, seed.authorization.mediaAssetId),
      seed.authorization,
    );
  }

  function sourceFor(companyId: string): PlaybackSource {
    const existing = sources.get(companyId);
    if (existing !== undefined) return existing;

    const source: PlaybackSource = (mediaAssetId) => {
      const key = keyOf(companyId, mediaAssetId);
      const current = held.get(key);
      if (current !== undefined && isPlaybackUsable(current, now())) {
        return Promise.resolve(current);
      }
      held.delete(key);

      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;

      const request = authorise(companyId, mediaAssetId)
        .then((fresh) => {
          held.set(key, fresh);
          return fresh;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, request);
      return request;
    };
    sources.set(companyId, source);
    return source;
  }

  return { sourceFor };
}
