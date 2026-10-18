import { cachingLoader } from "./cached-loader";
import { pageMediaCache } from "./media-cache";
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
 * The full hls.js build, never `hls.js/light`. Cloudflare Stream serves a
 * pitch's sound as a separate audio rendition (`#EXT-X-MEDIA:TYPE=AUDIO`
 * with the video levels pointing at `AUDIO="group_audio"`), and the light
 * build has no alternate-audio support: it plays the video track only, so
 * every pitch was silent with the element unmuted at volume 1 (measured in
 * production 2026-10-08: no audio fragment requested, 0 audio bytes
 * decoded, on Discover and Explore alike).
 */

function playsHlsNatively(video: HTMLVideoElement): boolean {
  // Empty string means "cannot play"; "maybe"/"probably" both mean it can.
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

/**
 * Media Source Extensions with H.264 and AAC: where present, the engine
 * plays the stream even if the browser also plays HLS natively. Chrome
 * now does (measured 2026-10-08, Chrome 155): its native player started
 * every pitch at 240p, refetched on the loop, and bypassed the device
 * cache. Only where there is no MSE (the iPhone) does the browser's own
 * player take it.
 */
function hasMse(): boolean {
  if (typeof window === "undefined" || typeof MediaSource === "undefined") {
    return false;
  }
  try {
    return MediaSource.isTypeSupported(
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
    );
  } catch {
    return false;
  }
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
 * §48/§51 as amended by ADR 0064).
 *
 * hls.js's own limit is the larger of `maxBufferLength` and what
 * `maxBufferSize` (60 MB) holds at the level's bitrate, capped only by
 * `maxMaxBufferLength` -- so the cap is the ceiling that actually binds.
 * A warm card (the next two, and the one behind) holds enough to start at
 * once and keep going while the rest arrives; the playing card buffers the
 * whole pitch (they are short), so its loop never goes back to the network.
 */
export type StreamWarmth = "warm" | "active";

export const BUFFER_SECONDS: Readonly<
  Record<StreamWarmth, { readonly ahead: number; readonly cap: number }>
> = {
  warm: { ahead: 10, cap: 12 },
  active: { ahead: 180, cap: 240 },
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
 * The first rung's bandwidth guess, before a single segment is measured.
 *
 * hls.js's defaults were the "Slow connection" every pitch started with
 * (measured 2026-10-08): a 500 kbit/s guess plus `testBandwidth`, which
 * loads the lowest rendition's first fragment to measure the link -- so
 * every pitch, on any connection, started at 240x426 and the player
 * announced a slow connection it had never measured. The guess is now the
 * link's own estimate (Network Information API `downlink`), discounted and
 * bounded, or a broadband default where the browser does not say; ABR then
 * measures real segments and moves down if the link truly cannot keep up.
 */
export const DEFAULT_START_ESTIMATE = 5_000_000;

/** The screen's long side in device pixels (at most 2x), for the first rung. */
export function startLongSide(): number {
  if (typeof window === "undefined") return 1280;
  return Math.round(
    Math.max(window.innerHeight, window.innerWidth) *
      Math.min(2, window.devicePixelRatio || 1),
  );
}

type Rung = {
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
};

/**
 * The first rendition: the smallest whose long side covers the screen's
 * (within 10%), among those the estimated bandwidth can carry; the largest
 * it can carry when none covers it. -1 for no renditions. Pure, shared
 * with the warm-up so both pick the same rung.
 */
export function pickStartLevel(
  levels: readonly Rung[],
  longSide: number,
  estimate: number,
): number {
  const order = levels
    .map((level, at) => ({ level, at }))
    .sort((a, b) => a.level.bitrate - b.level.bitrate);
  let best = order[0]?.at ?? -1;
  for (const { level, at } of order) {
    if (level.bitrate > estimate) break;
    best = at;
    if (Math.max(level.width, level.height) >= longSide * 0.9) return at;
  }
  return best;
}

export function startingBandwidthEstimate(): number {
  if (typeof navigator === "undefined") return DEFAULT_START_ESTIMATE;
  const link: unknown = Reflect.get(navigator, "connection");
  if (typeof link !== "object" || link === null) return DEFAULT_START_ESTIMATE;
  const downlink: unknown = Reflect.get(link, "downlink");
  if (
    typeof downlink !== "number" ||
    !Number.isFinite(downlink) ||
    downlink <= 0
  ) {
    return DEFAULT_START_ESTIMATE;
  }
  // Chrome rounds `downlink` and caps it at 10; a capped 10 means "fast".
  return Math.round(
    Math.min(20_000_000, Math.max(1_000_000, downlink * 1_000_000 * 0.8)),
  );
}

/** Each streamed element's in-place recovery. */
const streams = new WeakMap<HTMLVideoElement, () => boolean>();

/**
 * Where a pitch's picture starts: the first buffered instant, not 0. A
 * fragmented stream's first frame can sit a few milliseconds after 0, and
 * a seek to exactly 0 lands in a gap the engine fills by fetching the
 * first fragment again, at whatever rendition it is on by then -- which is
 * what broke the loop (measured 2026-10-08: a DEMUXER_ERROR on the seek
 * back, then a whole new grant and reload).
 */
export function loopStart(video: HTMLVideoElement): number {
  const ranges = video.buffered;
  if (ranges.length === 0) return 0;
  const first = ranges.start(0);
  return first > 0 && first < 1 ? first : 0;
}

/** The end of a pitch: back to its first frame, from memory, and on. */
export function restartPitch(video: HTMLVideoElement): void {
  video.currentTime = loopStart(video);
  void video.play().catch(() => undefined);
}

/**
 * A pitch that already played and then trips (a decoder error at the loop)
 * is recovered in place, from what is buffered and cached, rather than
 * with a new grant and a reload. False when there is no engine to recover
 * (native playback) or it already tried in the last minute.
 */
export function recoverStream(video: HTMLVideoElement): boolean {
  return streams.get(video)?.() ?? false;
}

/**
 * The adapter the feed uses.
 *
 * Progressive MP4, and HLS where there is no MSE (the iPhone), take the
 * plain path. Every other HLS stream loads the engine, and the detach function
 * destroys it — which is what actually cancels the segment fetches it
 * started (doc 20 §236's preload abort). With a media key, the engine's
 * loader reads and fills the pitch media cache (ADR 0064).
 */
export const attachHlsOrNativeSource: AttachSource = (video, url, mediaKey) => {
  if (!looksLikeHls(url) || (playsHlsNatively(video) && !hasMse())) {
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }

  let destroy: (() => void) | null = null;
  let cancelled = false;

  void import("hls.js")
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
      const cache = mediaKey === undefined ? null : pageMediaCache();
      const engine = new Hls({
        // A pitch is about 60 seconds and the preload budget is the
        // controller's: see BUFFER_SECONDS.
        maxBufferLength: BUFFER_SECONDS[warmth].ahead,
        maxMaxBufferLength: BUFFER_SECONDS[warmth].cap,
        // Fetch the first fragment while the media pipeline is still being
        // set up, so a warm card has frame one before it is swiped to.
        startFragPrefetch: true,
        // Loading starts once the first rung is chosen (MANIFEST_PARSED).
        autoStartLoad: false,
        // The stage is the size of the viewport; a rendition larger than
        // the element is bytes nobody sees.
        capLevelToPlayerSize: true,
        // The first rung is chosen from this estimate, not from a test
        // download of the lowest one (see startingBandwidthEstimate).
        abrEwmaDefaultEstimate: startingBandwidthEstimate(),
        testBandwidth: false,
        // Keep what was played: the loop and a swipe back read it from
        // memory rather than the network.
        backBufferLength: Infinity,
        // The stream carries its own subtitle rendition; the player shows
        // our same-origin captions <track>, so hls.js must not add a second
        // text track (the founder saw every caption twice).
        renderTextTracksNatively: false,
        enableWebVTT: false,
        enableIMSC1: false,
        enableCEA708Captions: false,
        ...(cache === null || mediaKey === undefined
          ? {}
          : {
              loader: cachingLoader(Hls.DefaultConfig.loader, mediaKey, cache),
            }),
      });
      engines.set(video, engine.config);
      // The first rung, chosen here rather than by hls.js (which measured
      // 240p first, then climbed): the screen's size within the link's
      // estimate. The warm-up picks the same rung, so its cached start is
      // the one played. Loading waits for it (autoStartLoad off): hls.js's
      // own start ran before this handler and began at the lowest rung.
      engine.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const level = pickStartLevel(
          data.levels,
          startLongSide(),
          startingBandwidthEstimate(),
        );
        if (level >= 0) engine.startLevel = level;
        engine.startLoad(-1);
      });
      // A fatal engine error (a codec this browser cannot decode, a
      // manifest that will not load) never reaches the element on its own:
      // it is said on the element, so the player can show its fallback
      // instead of a poster that never moves.
      // A fatal media error (the decoder or buffer tripping) is recovered
      // in place, as hls.js documents, before it counts as a failure.
      let recovering = false;
      const recover = (): boolean => {
        if (recovering) return false;
        recovering = true;
        const resume = loopStart(video);
        engine.recoverMediaError();
        video.currentTime = resume;
        void video.play().catch(() => undefined);
        // One recovery a minute: a stream that keeps tripping is a failure.
        window.setTimeout(() => {
          recovering = false;
        }, 60_000);
        return true;
      };
      engine.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recover()) return;
        video.dispatchEvent(new Event(PLAYBACK_FAILED_EVENT));
      });
      // A stream is looped by the player's `ended` (restartPitch), not by
      // the element: `loop` on an MSE element seeks to exactly 0 (see
      // loopStart), and with `loop` set `ended` never fires.
      const wasLooping = video.loop;
      video.loop = false;
      streams.set(video, recover);
      engine.loadSource(url);
      engine.attachMedia(video);
      destroy = () => {
        engines.delete(video);
        streams.delete(video);
        video.loop = wasLooping;
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
