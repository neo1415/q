import { PLAYBACK_FAILED_EVENT, type AttachSource } from "./pitch-playback";

/**
 * Getting an HLS manifest onto a `<video>` (CQ-WEB-021 decision, approved).
 *
 * Cloudflare Stream serves HLS. Safari and iOS play it from a plain `src`;
 * Chromium and Firefox cannot, and need Media Source Extensions driven by
 * a library. So this is one adapter with two paths, and the library is
 * imported only on the branch that needs it — a dynamic `import()` behind
 * a `canPlayType` check, so Safari and every MP4 pay nothing for it and it
 * never lands on the first-load or LCP path.
 *
 * hls.js light build: no DRM, no alternate audio tracks, no subtitles
 * engine — none of which a 60-second pitch uses, and all of which are most
 * of the full build's weight.
 */

function playsHlsNatively(video: HTMLVideoElement): boolean {
  // Empty string means "cannot play"; "maybe"/"probably" both mean it can.
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

function looksLikeHls(url: string): boolean {
  try {
    return new URL(url, "https://placeholder.invalid").pathname.endsWith(
      ".m3u8",
    );
  } catch {
    return false;
  }
}

/**
 * How much a stream may buffer ahead, by the controller's tier (doc 20
 * §48/§51; spec docs/specs/2026-10/harden.md §2).
 *
 * hls.js's own limit is the larger of `maxBufferLength` and what
 * `maxBufferSize` (60 MB) holds at the level's bitrate, capped only by
 * `maxMaxBufferLength` -- so `maxBufferLength` alone never limited a warm
 * card: it quietly buffered the whole pitch. The cap is the ceiling that
 * actually binds. A warm card holds a few seconds, enough for frame one and
 * an instant start; the playing card may run ahead normally.
 */
export type StreamWarmth = "warm" | "active";

const BUFFER_SECONDS: Readonly<
  Record<StreamWarmth, { readonly ahead: number; readonly cap: number }>
> = {
  warm: { ahead: 4, cap: 6 },
  active: { ahead: 30, cap: 60 },
};

type BufferConfig = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
};

/** The engine on each element, so the tier can change without re-attaching. */
const engines = new WeakMap<HTMLVideoElement, BufferConfig>();
/** The tier asked for before the engine existed (it loads asynchronously). */
const wanted = new WeakMap<HTMLVideoElement, StreamWarmth>();

function applyWarmth(config: BufferConfig, warmth: StreamWarmth): void {
  // hls.js reads these on every buffering tick, so changing them on a live
  // engine takes effect at the next fragment decision.
  config.maxBufferLength = BUFFER_SECONDS[warmth].ahead;
  config.maxMaxBufferLength = BUFFER_SECONDS[warmth].cap;
}

/**
 * The controller's tier for this element. Native playback (Safari, MP4)
 * has no such dial and ignores it; the browser's own heuristics apply.
 */
export function setStreamWarmth(
  video: HTMLVideoElement,
  warmth: StreamWarmth,
): void {
  wanted.set(video, warmth);
  const config = engines.get(video);
  if (config !== undefined) applyWarmth(config, warmth);
}

/**
 * The adapter the feed uses.
 *
 * Progressive MP4 and native-HLS browsers take the plain path. Only a
 * Chromium/Firefox HLS stream loads the engine, and the detach function
 * destroys it — which is what actually cancels the segment fetches it
 * started (doc 20 §236's preload abort).
 */
export const attachHlsOrNativeSource: AttachSource = (video, url) => {
  if (!looksLikeHls(url) || playsHlsNatively(video)) {
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }

  let destroy: (() => void) | null = null;
  let cancelled = false;

  void import("hls.js/light")
    .then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        // No MSE either. Attaching anyway is the honest fallback: the
        // element will report its own error rather than this failing
        // silently with a blank frame.
        video.src = url;
        return;
      }
      const warmth = wanted.get(video) ?? "warm";
      const engine = new Hls({
        // A pitch is about 60 seconds and the preload budget is the
        // controller's: see BUFFER_SECONDS.
        maxBufferLength: BUFFER_SECONDS[warmth].ahead,
        maxMaxBufferLength: BUFFER_SECONDS[warmth].cap,
        // Fetch the first fragment while the media pipeline is still being
        // set up, so a warm card has frame one before it is swiped to.
        startFragPrefetch: true,
        // The stage is the size of the viewport; a rendition larger than
        // the element is bytes nobody sees.
        capLevelToPlayerSize: true,
      });
      engines.set(video, engine.config);
      // A fatal engine error (a codec this browser cannot decode, a
      // manifest that will not load) never reaches the element on its own:
      // it is said on the element, so the player can show its fallback
      // instead of a poster that never moves.
      engine.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) video.dispatchEvent(new Event(PLAYBACK_FAILED_EVENT));
      });
      engine.loadSource(url);
      engine.attachMedia(video);
      destroy = () => {
        engines.delete(video);
        engine.destroy();
      };
    })
    .catch(() => {
      // The chunk did not load. Nothing to clean up, and the card shows
      // its poster rather than an exception.
    });

  return () => {
    cancelled = true;
    if (destroy !== null) destroy();
    else {
      video.removeAttribute("src");
      video.load();
    }
  };
};
