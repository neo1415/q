/**
 * Lane W (2026-10-15): the pitch video on screen, for the page manifest.
 *
 * A player registers while it is the card meant to be on screen; the
 * manifest reads its element's own state when a turn is sent (playing or
 * paused, a coarse position), so nothing here runs while the video plays.
 * Only the company and media ids and closed states leave the browser; the
 * Q API names the pitch only through the person's own company read.
 */

export type QMediaState =
  "PLAYING" | "PAUSED" | "BUFFERING" | "ENDED" | "FAILED";
export type QMediaPosition = "START" | "EARLY" | "MIDDLE" | "LATE" | "END";

export type QMediaEntry = {
  readonly companyId: string | null;
  readonly mediaAssetId: string | null;
  readonly video: () => HTMLVideoElement | null;
  /** The player says it cannot play this pitch. */
  readonly failed: () => boolean;
};

export type QMediaNow = {
  readonly kind: "PITCH";
  readonly companyId: string | null;
  readonly mediaAssetId: string | null;
  readonly state: QMediaState;
  readonly position?: QMediaPosition;
  readonly muted?: boolean;
};

const entries: QMediaEntry[] = [];

export function registerQMedia(entry: QMediaEntry): () => void {
  entries.push(entry);
  return () => {
    const at = entries.indexOf(entry);
    if (at >= 0) entries.splice(at, 1);
  };
}

export function positionOf(
  currentTime: number,
  duration: number,
): QMediaPosition | undefined {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const at = Math.min(1, Math.max(0, currentTime / duration));
  if (at < 0.1) return "START";
  if (at < 0.35) return "EARLY";
  if (at < 0.65) return "MIDDLE";
  if (at < 0.9) return "LATE";
  return "END";
}

function stateOf(entry: QMediaEntry, video: HTMLVideoElement): QMediaState {
  if (entry.failed()) return "FAILED";
  if (video.ended) return "ENDED";
  if (video.paused) return "PAUSED";
  // HAVE_FUTURE_DATA: below it a playing element is waiting for bytes.
  return video.readyState < 3 ? "BUFFERING" : "PLAYING";
}

/**
 * The pitch on screen now: the newest registered player that is playing,
 * else the newest one. A player inside a part hidden from Q is skipped.
 */
export function mediaNow(): QMediaNow | undefined {
  const live = entries.filter((entry) => {
    const video = entry.video();
    return video !== null && video.closest("[data-q-hidden]") === null;
  });
  const chosen =
    [...live].reverse().find((entry) => entry.video()?.paused === false) ??
    live.at(-1);
  const video = chosen?.video() ?? null;
  if (chosen === undefined || video === null) return undefined;
  const position = positionOf(video.currentTime, video.duration);
  return {
    kind: "PITCH",
    companyId: chosen.companyId,
    mediaAssetId: chosen.mediaAssetId,
    state: stateOf(chosen, video),
    ...(position === undefined ? {} : { position }),
    muted: video.muted,
  };
}

/** Tests. */
export function resetQMedia(): void {
  entries.length = 0;
}
