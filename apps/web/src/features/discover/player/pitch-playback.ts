import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import type { FeedPreloadPolicy } from "../feed/feed-state";

/**
 * What the controller's policy means for one <video> (CQ-WEB-021; doc 20
 * §35-§36, §43-§50, §54; ADR-001 reduced motion).
 *
 * The feed controller decides which card is active, warm or cold. This
 * module is the only translation of that decision into element state, and
 * it is a pure function so the mapping can be asserted without a browser.
 * No component chooses its own preload: doc 20 §260.6 names
 * `preload="auto"` scattered through feed components as the anti-pattern,
 * and the way to not do that is for there to be exactly one place where
 * the attribute comes from.
 */

/**
 * The element's marching orders.
 *
 * `authorize` and `attach` are separate because they cost different
 * things. Authorising is a short API call that yields a poster URL and a
 * short-lived playback URL; attaching a source is what makes the browser
 * fetch billable media. A postered card needs the first and must not do
 * the second.
 */
export type PitchPlaybackIntent = {
  /** Ask the server for a playback authorization (poster included). */
  readonly authorize: boolean;
  /** Put the playback URL on the element. */
  readonly attach: boolean;
  /** The `preload` attribute, or null when no source is attached. */
  readonly preload: "none" | "metadata" | "auto" | null;
  /** Start playing without being asked. */
  readonly autoplay: boolean;
  /** Offer a Play control, because nothing will start on its own. */
  readonly requiresExplicitPlay: boolean;
};

const COLD: PitchPlaybackIntent = {
  authorize: false,
  attach: false,
  preload: null,
  autoplay: false,
  requiresExplicitPlay: false,
};

/**
 * Policy to element state.
 *
 * Reduced motion never removes the video, it removes the surprise: ADR-001
 * is explicit that it disables automatic playback, not access. So an
 * ACTIVE card under reduced motion still authorises and still attaches its
 * source — the person can press Play and it starts immediately — it simply
 * does not begin on its own, and the audio stays off until they turn it on.
 */
export function playbackIntentFor(
  policy: FeedPreloadPolicy,
  options: { readonly reducedMotion: boolean },
): PitchPlaybackIntent {
  switch (policy) {
    case "NONE":
      return COLD;

    case "POSTER":
      // The poster is an image from the CDN. No source is attached, so the
      // browser fetches no media segments for a card that may never be
      // reached.
      return {
        authorize: true,
        attach: false,
        preload: null,
        autoplay: false,
        requiresExplicitPlay: false,
      };

    case "METADATA":
      return {
        authorize: true,
        attach: true,
        preload: "metadata",
        autoplay: false,
        requiresExplicitPlay: false,
      };

    case "STARTUP_BUFFER":
      // `auto` for the controller's one next card, so it is ready the
      // moment it is swiped to (founder report 2026-10-01: every pitch
      // took seconds to start). `metadata` made native HLS (Safari, iOS)
      // fetch the manifest and nothing else. The budget doc 20 §51 asks
      // for is held where the bytes are actually controlled: the hls.js
      // engine buffers a short start for a warm card (hls-source.ts), and
      // only one card is ever in this tier. Delivery is billed per minute
      // (~$1 per 1,000), so one warm minute per swipe is the price of an
      // instant start.
      return {
        authorize: true,
        attach: true,
        preload: "auto",
        autoplay: false,
        requiresExplicitPlay: false,
      };

    case "ACTIVE":
      return {
        authorize: true,
        attach: true,
        // Decided here, by the controller's policy, for the one card that
        // is playing -- which is the opposite of scattering it.
        preload: options.reducedMotion ? "metadata" : "auto",
        autoplay: !options.reducedMotion,
        requiresExplicitPlay: options.reducedMotion,
      };
  }
}

/**
 * How long before expiry a playback URL is treated as spent.
 *
 * A URL that expires while the person is watching fails mid-playback, so
 * the margin is wide enough to cover a slow re-authorisation rather than
 * merely the clock.
 */
export const PLAYBACK_EXPIRY_SKEW_MS = 30_000;

/**
 * Is this authorization still usable?
 *
 * Authorizations are per-viewer and short-lived by design (doc 20: a
 * provider UID is not access control). They are therefore never cached
 * across cards and never reused after expiry -- the card re-asks, and the
 * server decides again whether this viewer may watch.
 */
export function isPlaybackUsable(
  authorization: PlaybackAuthorizationDto | null,
  nowMs: number,
  skewMs: number = PLAYBACK_EXPIRY_SKEW_MS,
): boolean {
  if (authorization === null) return false;
  const expiresAtMs = Date.parse(authorization.expiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return expiresAtMs - skewMs > nowMs;
}

/**
 * Asking the server for a playback URL.
 *
 * Injected rather than imported: the real client lands with CQ-MEDIA-011
 * and CQ-WEB-022 wires it in. The port is the whole coupling.
 */
export type PlaybackSource = (
  mediaAssetId: string,
) => Promise<PlaybackAuthorizationDto>;

/**
 * How a URL becomes a playing element.
 *
 * Cloudflare Stream serves HLS and DASH. Safari plays HLS from a plain
 * `src`; Chromium and Firefox do not, and need Media Source Extensions
 * driven by a library. That difference is the only reason this is a
 * strategy: the wrapper stays a plain `<video>` and the engine is one
 * adapter, so choosing or replacing it never reaches this component.
 *
 * The returned function detaches — stopping any in-flight fetch the engine
 * started, which is doc 20 §236's preload abort.
 */
/** Dispatched on the element by a source strategy that failed for good. */
export const PLAYBACK_FAILED_EVENT = "cq-playback-failed";

/**
 * How long an attached, playing-intended pitch may show no frame before the
 * player says it cannot play here: a browser that cannot decode the stream
 * (no H.264) sits at readyState 0 without ever raising an error.
 */
export const FIRST_FRAME_TIMEOUT_MS = 8_000;

export type AttachSource = (video: HTMLVideoElement, url: string) => () => void;

/**
 * The native path: progressive MP4, or HLS on a browser that reads it.
 *
 * This is what ships today. It is correct on Safari and iOS for HLS and
 * correct everywhere for MP4; a Chromium HLS stream needs the adapter
 * above, which is a decision still open with the lead.
 */
export const attachNativeSource: AttachSource = (video, url) => {
  video.src = url;
  return () => {
    // Clearing the attribute and reloading is what actually cancels an
    // in-flight media fetch; dropping the element reference alone does not.
    video.removeAttribute("src");
    video.load();
  };
};
