import {
  pickStartLevel,
  startingBandwidthEstimate,
  startLongSide,
} from "./hls-source";
import { mediaCacheKey, pageMediaCache, type MediaCache } from "./media-cache";

/**
 * Warming the first pitches before Discover opens (ADR 0063; founder
 * 2026-10-08: "before you even open the app, 2-3 videos are already
 * cached"). Given a URL the server authorised for this viewer, fetch the
 * start of the stream -- the init segments and first fragments of the
 * renditions the player is likely to start on, and the audio -- into the
 * pitch media cache, so Discover's first frames come from the device.
 *
 * The playlists themselves are read and never stored here: the player
 * always fetches them fresh (doc 20 §29).
 */

/** Fragments warmed per rendition: a few seconds, enough to start. */
const FRAGMENTS = 2;

type Variant = {
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly uri: string;
};

/** The video renditions and the audio playlist a master playlist names. */
export function parseMaster(text: string): {
  readonly variants: readonly Variant[];
  readonly audio: string | null;
} {
  const lines = text.split(/\r?\n/);
  const variants: Variant[] = [];
  let audio: string | null = null;
  lines.forEach((line, at) => {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const resolution = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      const bandwidth = /[:,]BANDWIDTH=(\d+)/.exec(line);
      const uri = lines
        .slice(at + 1)
        .find((next) => next.trim() !== "" && !next.startsWith("#"));
      if (resolution !== null && uri !== undefined) {
        variants.push({
          width: Number(resolution[1]),
          height: Number(resolution[2]),
          bitrate: Number(bandwidth?.[1] ?? "0"),
          uri: uri.trim(),
        });
      }
    } else if (
      audio === null &&
      line.startsWith("#EXT-X-MEDIA:") &&
      line.includes("TYPE=AUDIO")
    ) {
      audio = /URI="([^"]+)"/.exec(line)?.[1] ?? null;
    }
  });
  variants.sort((a, b) => a.bitrate - b.bitrate);
  return { variants, audio };
}

/** The init segment and the first fragments a media playlist names. */
export function parseMedia(text: string, count = FRAGMENTS): readonly string[] {
  const out: string[] = [];
  let fragments = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#EXT-X-MAP:")) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri !== undefined) out.push(uri);
    } else if (line.trim() !== "" && !line.startsWith("#")) {
      if (fragments >= count) break;
      out.push(line.trim());
      fragments += 1;
    }
  }
  return out;
}

/**
 * The rendition the player will start on (the same pick, hls-source.ts)
 * and the one below it, in case the player's estimate is lower by then.
 */
export function renditionsFor(
  variants: readonly Variant[],
  longSide: number,
  estimate: number,
): readonly Variant[] {
  const at = pickStartLevel(variants, longSide, estimate);
  if (at < 0) return [];
  return variants.slice(Math.max(0, at - 1), at + 1);
}

async function text(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

async function store(
  cache: MediaCache,
  mediaKey: string,
  url: string,
  signal: AbortSignal,
): Promise<void> {
  const key = mediaCacheKey(mediaKey, url);
  if (key === null || (await cache.get(key)) !== null) return;
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) return;
  await cache.put(key, await response.arrayBuffer());
}

export async function warmPitch(
  playbackUrl: string,
  mediaKey: string,
  signal: AbortSignal,
): Promise<void> {
  const cache = pageMediaCache();
  if (cache === null) return;
  const master = await text(playbackUrl, signal);
  const { variants, audio } = parseMaster(master);
  const playlists = [
    ...renditionsFor(
      variants,
      startLongSide(),
      startingBandwidthEstimate(),
    ).map((variant) => variant.uri),
    ...(audio === null ? [] : [audio]),
  ].map((uri) => new URL(uri, playbackUrl).href);
  for (const playlist of playlists) {
    const media = await text(playlist, signal);
    for (const uri of parseMedia(media)) {
      await store(cache, mediaKey, new URL(uri, playlist).href, signal);
    }
  }
}
