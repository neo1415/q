/**
 * The pitch media cache (ADR 0063; founder direction 2026-10-08: "once a
 * video is played it's cached ... a FIFO cache with a high budget").
 *
 * A pitch's HLS segments are immutable (`Cache-Control: public,
 * max-age=864000` from the CDN), but every playback grant carries its token
 * in the URL path, so the browser's own HTTP cache misses every time a new
 * grant is issued: a revisit, a loop after the grant rotated, a pitch seen
 * yesterday. This cache keys the bytes by the media asset and the path
 * after the token, so the same bytes are found under any grant.
 *
 * What it is not: an access path. Nothing here produces a URL or plays
 * anything. A cached byte is only read by an engine the player created
 * from a URL the server authorised for this viewer, under this media asset
 * id; without a grant nothing asks. The whole cache is dropped on sign-out.
 *
 * Eviction is least-recently-used within a byte budget: insertion order,
 * with a hit moving an entry to the back -- FIFO for what is never watched
 * again, kept for what is. The budget is the smaller of 1 GiB and 40% of
 * the origin's quota (navigator.storage.estimate()).
 *
 * Playlists are not treated like segments: they are fetched from the
 * network every time and the cached copy is only an offline fallback
 * (doc 20 §29: Stream manifests can change).
 */

export const MEDIA_CACHE_NAME = "cq-media-v1";
const KEY_ORIGIN = "https://cq-media.invalid";
const INDEX_KEY = `${KEY_ORIGIN}/__index`;
export const MEDIA_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
const MEDIA_CACHE_MIN_BYTES = 64 * 1024 * 1024;
const QUOTA_SHARE = 0.4;

/** A path segment that is a signed token (or a bare Stream uid), not a name. */
const TOKEN_SEGMENT = /^[A-Za-z0-9_\-.~]{32,}$/;
/** Stream's playlist names carry a revision that changes per fetch. */
const PLAYLIST_REVISION = /_r\d+(?=\.m3u8$)/;

/**
 * The stable key for a media URL, or null when it should not be cached.
 *
 * `https://customer-x.cloudflarestream.com/<token>/video/426/seg_1.mp4`
 * under asset `A` keys as `https://cq-media.invalid/A/video/426/seg_1.mp4`:
 * the token (which rotates per grant) and the query are dropped, the media
 * asset id the player was authorised for is the namespace.
 */
export function mediaCacheKey(mediaKey: string, url: string): string | null {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(mediaKey)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const rest =
    parts.length > 1 && TOKEN_SEGMENT.test(parts[0] ?? "")
      ? parts.slice(1)
      : parts;
  const last = rest.length - 1;
  rest[last] = (rest[last] ?? "").replace(PLAYLIST_REVISION, "");
  return `${KEY_ORIGIN}/${mediaKey}/${rest.map(encodeURIComponent).join("/")}`;
}

export function isPlaylistUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(".m3u8");
  } catch {
    return false;
  }
}

export type CacheEntry = { readonly key: string; readonly bytes: number };

/**
 * Which entries to drop, oldest first, so the total fits the budget after
 * `incoming` bytes are added. Pure, for the tests.
 */
export function evictionPlan(
  entries: readonly CacheEntry[],
  incoming: number,
  budget: number,
): readonly string[] {
  let total = incoming;
  for (const entry of entries) total += entry.bytes;
  const drop: string[] = [];
  for (const entry of entries) {
    if (total <= budget) break;
    drop.push(entry.key);
    total -= entry.bytes;
  }
  return drop;
}

/** The parts of Cache Storage this module uses, so tests can fake them. */
export type CacheLike = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
};
export type CacheStorageLike = {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
};

type Body = ArrayBuffer | string;

export type MediaCache = {
  get(key: string): Promise<Body | null>;
  put(key: string, body: Body): Promise<void>;
  /** For tests and the budget line in a report. */
  entries(): Promise<readonly CacheEntry[]>;
};

function byteLength(body: Body): number {
  return typeof body === "string" ? body.length * 2 : body.byteLength;
}

export async function cacheBudget(
  storage: Pick<StorageManager, "estimate"> | undefined,
): Promise<number> {
  try {
    const estimate = await storage?.estimate();
    const quota = estimate?.quota;
    if (typeof quota !== "number" || !Number.isFinite(quota) || quota <= 0) {
      return MEDIA_CACHE_MAX_BYTES / 4;
    }
    return Math.max(
      MEDIA_CACHE_MIN_BYTES,
      Math.min(MEDIA_CACHE_MAX_BYTES, Math.floor(quota * QUOTA_SHARE)),
    );
  } catch {
    return MEDIA_CACHE_MAX_BYTES / 4;
  }
}

/**
 * A media cache over a Cache Storage-like store. The index (key, bytes, in
 * use order) lives in the same cache under one entry, and every write is
 * serialised through one chain so two segments landing together cannot
 * both read the old index.
 */
export function createMediaCache(
  storage: CacheStorageLike,
  budget: () => Promise<number>,
): MediaCache {
  let opened: Promise<{ cache: CacheLike; index: CacheEntry[] }> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const open = () => {
    opened ??= (async () => {
      const cache = await storage.open(MEDIA_CACHE_NAME);
      let index: CacheEntry[] = [];
      try {
        const stored = await cache.match(INDEX_KEY);
        const parsed: unknown = stored === undefined ? [] : await stored.json();
        if (Array.isArray(parsed)) {
          index = parsed.filter(
            (entry: unknown): entry is CacheEntry =>
              typeof entry === "object" &&
              entry !== null &&
              typeof Reflect.get(entry, "key") === "string" &&
              typeof Reflect.get(entry, "bytes") === "number",
          );
        }
      } catch {
        index = [];
      }
      return { cache, index };
    })();
    return opened;
  };

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const saveIndex = (cache: CacheLike, index: readonly CacheEntry[]) =>
    cache.put(
      INDEX_KEY,
      new Response(JSON.stringify(index), {
        headers: { "content-type": "application/json" },
      }),
    );

  return {
    async get(key) {
      try {
        const { cache, index } = await open();
        const hit = await cache.match(key);
        if (hit === undefined) return null;
        const body: Body =
          hit.headers.get("content-type") === "text/plain"
            ? await hit.text()
            : await hit.arrayBuffer();
        // A hit is a use: it moves to the back of the line.
        void serial(async () => {
          const at = index.findIndex((entry) => entry.key === key);
          if (at < 0 || at === index.length - 1) return;
          const [entry] = index.splice(at, 1);
          if (entry !== undefined) index.push(entry);
          await saveIndex(cache, index);
        }).catch(() => undefined);
        return body;
      } catch {
        return null;
      }
    },
    put(key, body) {
      return serial(async () => {
        const { cache, index } = await open();
        const bytes = byteLength(body);
        const limit = await budget();
        if (bytes > limit) return;
        const existing = index.findIndex((entry) => entry.key === key);
        if (existing >= 0) index.splice(existing, 1);
        for (const drop of evictionPlan(index, bytes, limit)) {
          await cache.delete(drop);
          const at = index.findIndex((entry) => entry.key === drop);
          if (at >= 0) index.splice(at, 1);
        }
        await cache.put(
          key,
          new Response(body, {
            headers: {
              "content-type":
                typeof body === "string"
                  ? "text/plain"
                  : "application/octet-stream",
            },
          }),
        );
        index.push({ key, bytes });
        await saveIndex(cache, index);
      }).catch(() => undefined);
    },
    async entries() {
      const { index } = await open();
      return [...index];
    },
  };
}

let shared: MediaCache | null = null;

/** The page's media cache, or null where Cache Storage is unavailable. */
export function pageMediaCache(): MediaCache | null {
  if (shared !== null) return shared;
  if (typeof window === "undefined" || typeof caches === "undefined") {
    return null;
  }
  let budget: Promise<number> | null = null;
  shared = createMediaCache(caches, () => {
    budget ??= cacheBudget(
      typeof navigator === "undefined" ? undefined : navigator.storage,
    );
    return budget;
  });
  return shared;
}

/**
 * Sign-out drops every cached pitch: the next person on this browser
 * starts with nothing of the last one's (doc 20 §158).
 */
export async function clearMediaCache(): Promise<void> {
  shared = null;
  try {
    if (typeof caches !== "undefined") await caches.delete(MEDIA_CACHE_NAME);
  } catch {
    // Nothing cached, or storage unavailable: nothing to clear.
  }
}
