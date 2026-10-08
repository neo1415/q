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

type Variant = { readonly height: number; readonly uri: string };

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
      const uri = lines
        .slice(at + 1)
        .find((next) => next.trim() !== "" && !next.startsWith("#"));
      if (resolution !== null && uri !== undefined) {
        variants.push({
          height: Math.max(Number(resolution[1]), Number(resolution[2])),
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
  variants.sort((a, b) => a.height - b.height);
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
 * The two renditions either side of the screen's long side: the player's
 * first rung is one of them on this screen (it is capped to the player's
 * size, which is about the viewport).
 */
export function renditionsFor(
  variants: readonly Variant[],
  longSide: number,
): readonly Variant[] {
  if (variants.length === 0) return [];
  const above = variants.findIndex((variant) => variant.height >= longSide);
  const at = above < 0 ? variants.length - 1 : above;
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
  longSide: number,
): Promise<void> {
  const cache = pageMediaCache();
  if (cache === null) return;
  const master = await text(playbackUrl, signal);
  const { variants, audio } = parseMaster(master);
  const playlists = [
    ...renditionsFor(variants, longSide).map((variant) => variant.uri),
    ...(audio === null ? [] : [audio]),
  ].map((uri) => new URL(uri, playbackUrl).href);
  for (const playlist of playlists) {
    const media = await text(playlist, signal);
    for (const uri of parseMedia(media)) {
      await store(cache, mediaKey, new URL(uri, playlist).href, signal);
    }
  }
}
