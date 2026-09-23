import type { AttachSource } from "./pitch-playback";

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
      const engine = new Hls({
        // A pitch is about 60 seconds and the preload budget is the
        // controller's, so the engine is told to keep a short buffer
        // rather than race ahead filling one.
        maxBufferLength: 10,
      });
      engine.loadSource(url);
      engine.attachMedia(video);
      destroy = () => engine.destroy();
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
