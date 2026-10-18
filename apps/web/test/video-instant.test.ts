// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";

import { cachingLoader } from "../src/features/discover/player/cached-loader";
import { pickStartLevel } from "../src/features/discover/player/hls-source";
import {
  cacheBudget,
  createMediaCache,
  evictionPlan,
  MEDIA_CACHE_MAX_BYTES,
  mediaCacheKey,
  type CacheLike,
  type CacheStorageLike,
} from "../src/features/discover/player/media-cache";
import {
  audioMayPlay,
  chooseSound,
  onAudioUnlock,
  resetSoundChoiceForTests,
  soundMuted,
} from "../src/features/discover/player/sound-policy";
import {
  parseMaster,
  parseMedia,
  renditionsFor,
} from "../src/features/discover/player/pitch-warmup";
import {
  DEFAULT_PREFETCH_BUDGET,
  policyForOffset,
} from "../src/features/discover/feed/feed-state";

/**
 * Video that is already there (ADR 0064): the preload window, the pitch
 * media cache and its eviction, the cache in front of hls.js, and the one
 * sound policy for Discover and Explore.
 */

const ASSET = "6f1c3c3a-0000-4000-8000-000000000001";
const TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1aWQifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

function memoryStorage(): CacheStorageLike & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  const cache: CacheLike = {
    match: (key) => Promise.resolve(store.get(key)?.clone()),
    put: (key, response) => {
      store.set(key, response);
      return Promise.resolve();
    },
    delete: (key) => Promise.resolve(store.delete(key)),
  };
  return {
    store,
    open: () => Promise.resolve(cache),
    delete: () => {
      store.clear();
      return Promise.resolve(true);
    },
  };
}

describe("the preload window", () => {
  it("buffers the next two, keeps the one behind, posters the one after", () => {
    const at = (offset: number) =>
      policyForOffset(offset, DEFAULT_PREFETCH_BUDGET);
    expect([-2, -1, 0, 1, 2, 3, 4].map(at)).toEqual([
      "NONE",
      "STARTUP_BUFFER",
      "ACTIVE",
      "STARTUP_BUFFER",
      "STARTUP_BUFFER",
      "POSTER",
      "NONE",
    ]);
  });
});

describe("the media cache key", () => {
  it("is the asset and the path after the rotating token, never the token", () => {
    const one = mediaCacheKey(
      ASSET,
      `https://customer-x.cloudflarestream.com/${TOKEN}/video/426/seg_1.mp4`,
    );
    const two = mediaCacheKey(
      ASSET,
      `https://customer-x.cloudflarestream.com/${TOKEN.replace("c2ln", "ZZZZ")}/video/426/seg_1.mp4?x=1`,
    );
    expect(one).toBe(`https://cq-media.invalid/${ASSET}/video/426/seg_1.mp4`);
    expect(two).toBe(one);
    expect(one).not.toContain(TOKEN);
  });

  it("drops the playlist revision Stream changes on every fetch", () => {
    const a = mediaCacheKey(
      ASSET,
      `https://c.test/${TOKEN}/manifest/stream_tef89_r192664435.m3u8`,
    );
    const b = mediaCacheKey(
      ASSET,
      `https://c.test/${TOKEN}/manifest/stream_tef89_r192664442.m3u8`,
    );
    expect(a).toBe(b);
    expect(a).toMatch(/stream_tef89\.m3u8$/);
  });

  it("refuses a key it cannot namespace", () => {
    expect(mediaCacheKey("../etc", "https://c.test/a.mp4")).toBeNull();
    expect(mediaCacheKey(ASSET, "not a url")).toBeNull();
    expect(mediaCacheKey(ASSET, "data:video/mp4;base64,AA")).toBeNull();
  });
});

describe("eviction", () => {
  it("drops the oldest first, only as much as the newcomer needs", () => {
    const entries = [
      { key: "a", bytes: 40 },
      { key: "b", bytes: 40 },
      { key: "c", bytes: 40 },
    ];
    expect(evictionPlan(entries, 10, 200)).toEqual([]);
    expect(evictionPlan(entries, 50, 150)).toEqual(["a"]);
    expect(evictionPlan(entries, 100, 150)).toEqual(["a", "b"]);
  });

  it("evicts least recently used: a hit moves an entry to the back", async () => {
    const storage = memoryStorage();
    const cache = createMediaCache(storage, () => Promise.resolve(300));
    const bytes = (n: number) => new ArrayBuffer(n);
    await cache.put("https://cq-media.invalid/a/1", bytes(100));
    await cache.put("https://cq-media.invalid/a/2", bytes(100));
    await cache.put("https://cq-media.invalid/a/3", bytes(100));
    // A replay of the first: it is the one kept.
    expect(await cache.get("https://cq-media.invalid/a/1")).not.toBeNull();
    await vi.waitFor(async () =>
      expect((await cache.entries()).at(-1)?.key).toBe(
        "https://cq-media.invalid/a/1",
      ),
    );
    await cache.put("https://cq-media.invalid/a/4", bytes(100));
    const keys = (await cache.entries()).map((entry) => entry.key);
    expect(keys).toEqual([
      "https://cq-media.invalid/a/3",
      "https://cq-media.invalid/a/1",
      "https://cq-media.invalid/a/4",
    ]);
    expect(storage.store.has("https://cq-media.invalid/a/2")).toBe(false);
    expect(await cache.get("https://cq-media.invalid/a/2")).toBeNull();
  });

  it("budgets 40% of the quota, never more than 1 GiB", async () => {
    const at = (quota: number) =>
      cacheBudget({ estimate: () => Promise.resolve({ quota, usage: 0 }) });
    expect(await at(1_000_000_000)).toBe(400_000_000);
    expect(await at(100_000_000_000)).toBe(MEDIA_CACHE_MAX_BYTES);
    expect(await cacheBudget(undefined)).toBe(MEDIA_CACHE_MAX_BYTES / 4);
  });
});

describe("the cache in front of hls.js", () => {
  type Calls = { loads: LoaderContext[] };
  function fakeBase(calls: Calls, respond: "ok" | "error") {
    return class FakeLoader implements Loader<LoaderContext> {
      context: LoaderContext | null = null;
      stats = {} as LoaderStats;
      constructor(_config: HlsConfig) {}
      destroy() {}
      abort() {}
      load(
        context: LoaderContext,
        _config: LoaderConfiguration,
        callbacks: LoaderCallbacks<LoaderContext>,
      ) {
        calls.loads.push(context);
        if (respond === "error") {
          callbacks.onError(
            { code: 0, text: "offline" },
            context,
            null,
            this.stats,
          );
          return;
        }
        const data =
          context.responseType === "arraybuffer"
            ? new Uint8Array([1, 2, 3]).buffer
            : "#EXTM3U";
        callbacks.onSuccess(
          { url: context.url, data },
          this.stats,
          context,
          null,
        );
      }
    };
  }
  const config = {} as HlsConfig;
  const loaderConfig = {} as LoaderConfiguration;
  function load(
    Loader: new (config: HlsConfig) => Loader<LoaderContext>,
    url: string,
    responseType: "arraybuffer" | "text",
    range: { rangeStart?: number; rangeEnd?: number } = {},
  ) {
    return new Promise<{ ok: boolean; data: unknown }>((resolve) => {
      new Loader(config).load(
        { url, responseType, type: "manifest", ...range } as LoaderContext,
        loaderConfig,
        {
          onSuccess: (response) => resolve({ ok: true, data: response.data }),
          onError: () => resolve({ ok: false, data: null }),
          onTimeout: () => resolve({ ok: false, data: null }),
        },
      );
    });
  }

  it("serves a segment from the device under a new grant, without the network", async () => {
    const cache = createMediaCache(memoryStorage(), () => Promise.resolve(1e9));
    const online: Calls = { loads: [] };
    const first = cachingLoader(fakeBase(online, "ok"), ASSET, cache);
    const segment = `https://c.test/${TOKEN}/video/720/seg_1.mp4`;
    expect((await load(first, segment, "arraybuffer")).ok).toBe(true);
    expect(online.loads).toHaveLength(1);
    await vi.waitFor(async () => expect(await cache.entries()).toHaveLength(1));

    // Offline, a new token: the loop, the swipe back, the revisit.
    const offline: Calls = { loads: [] };
    const second = cachingLoader(fakeBase(offline, "error"), ASSET, cache);
    const hit = await load(
      second,
      segment.replace(TOKEN, `${TOKEN}x`),
      "arraybuffer",
    );
    expect(hit.ok).toBe(true);
    expect(new Uint8Array(hit.data as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(offline.loads).toHaveLength(0);
  });

  it("caches the fragments hls.js really asks for (range 0-0 means no range)", async () => {
    // hls.js's fragment loader sets rangeStart 0 and rangeEnd 0 on every
    // fragment; only a non-zero end is a byte range.
    const cache = createMediaCache(memoryStorage(), () => Promise.resolve(1e9));
    const online: Calls = { loads: [] };
    const loader = cachingLoader(fakeBase(online, "ok"), ASSET, cache);
    const segment = `https://c.test/${TOKEN}/audio/130/seg_1.mp4`;
    const noRange = { rangeStart: 0, rangeEnd: 0 };
    await load(loader, segment, "arraybuffer", noRange);
    await vi.waitFor(async () => expect(await cache.entries()).toHaveLength(1));
    const offline: Calls = { loads: [] };
    const again = cachingLoader(fakeBase(offline, "error"), ASSET, cache);
    expect((await load(again, segment, "arraybuffer", noRange)).ok).toBe(true);
    expect(offline.loads).toHaveLength(0);

    // A real byte range is another shape of the file: never keyed.
    const ranged = { rangeStart: 0, rangeEnd: 1024 };
    const net: Calls = { loads: [] };
    const part = cachingLoader(fakeBase(net, "ok"), ASSET, cache);
    await load(part, segment.replace("seg_1", "seg_2"), "arraybuffer", ranged);
    expect(net.loads).toHaveLength(1);
    expect(await cache.entries()).toHaveLength(1);
  });

  it("always asks the network for a playlist, and answers from the device only offline", async () => {
    const cache = createMediaCache(memoryStorage(), () => Promise.resolve(1e9));
    const playlist = `https://c.test/${TOKEN}/manifest/video.m3u8`;
    const online: Calls = { loads: [] };
    const loader = cachingLoader(fakeBase(online, "ok"), ASSET, cache);
    await load(loader, playlist, "text");
    await load(loader, playlist, "text");
    expect(online.loads).toHaveLength(2);
    await vi.waitFor(async () => expect(await cache.entries()).toHaveLength(1));

    const offline: Calls = { loads: [] };
    const fallback = cachingLoader(fakeBase(offline, "error"), ASSET, cache);
    const answer = await load(fallback, playlist, "text");
    expect(offline.loads).toHaveLength(1);
    expect(answer).toEqual({ ok: true, data: "#EXTM3U" });
  });

  it("does not cache another asset's bytes under this one", async () => {
    const cache = createMediaCache(memoryStorage(), () => Promise.resolve(1e9));
    const online: Calls = { loads: [] };
    const loader = cachingLoader(fakeBase(online, "ok"), ASSET, cache);
    await load(
      loader,
      `https://c.test/${TOKEN}/video/720/seg_1.mp4`,
      "arraybuffer",
    );
    await vi.waitFor(async () => expect(await cache.entries()).toHaveLength(1));
    const other = cachingLoader(
      fakeBase({ loads: [] }, "error"),
      "6f1c3c3a-0000-4000-8000-000000000002",
      cache,
    );
    const miss = await load(
      other,
      `https://c.test/${TOKEN}/video/720/seg_1.mp4`,
      "arraybuffer",
    );
    expect(miss.ok).toBe(false);
  });
});

describe("sound", () => {
  afterEach(() => {
    resetSoundChoiceForTests();
    Reflect.deleteProperty(navigator, "userActivation");
  });

  it("is on by default, every session; reduced motion starts it off", () => {
    expect(soundMuted(null, false)).toBe(false);
    expect(soundMuted(null, true)).toBe(true);
  });

  it("remembers an explicit mute for this session only", () => {
    chooseSound(true);
    expect(window.sessionStorage.getItem("cq-pitch-sound")).toBe("muted");
    expect(window.localStorage.getItem("cq-pitch-sound")).toBeNull();
    expect(soundMuted("muted", false)).toBe(true);
    chooseSound(false);
    expect(soundMuted("on", true)).toBe(false);
  });

  it("unlocks only once the browser has granted activation, never on a scroll", async () => {
    let active = false;
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      get: () => ({ hasBeenActive: active, isActive: active }),
    });
    expect(audioMayPlay()).toBe(false);
    const unlocked = vi.fn();
    const stop = onAudioUnlock(unlocked);
    // A touch that scrolled: no activation, so the sound stays off rather
    // than unmuting into a paused video.
    window.dispatchEvent(new Event("touchend"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(unlocked).not.toHaveBeenCalled();
    active = true;
    window.dispatchEvent(new Event("pointerup"));
    await vi.waitFor(() => expect(unlocked).toHaveBeenCalledTimes(1));
    stop();
  });
});

describe("warming the first pitches", () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="original",URI="stream_ta_r1.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1080x1920,AUDIO="a"',
    "stream_t1920_r1.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=240x426,AUDIO="a"',
    "stream_t426_r1.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=720x1282,AUDIO="a"',
    "stream_t1282_r1.m3u8",
  ].join("\n");

  it("reads the renditions, cheapest first, and the audio", () => {
    const parsed = parseMaster(master);
    expect(parsed.variants.map((v) => v.height)).toEqual([426, 1282, 1920]);
    expect(parsed.variants.map((v) => v.bitrate)).toEqual([
      200000, 500000, 900000,
    ]);
    expect(parsed.audio).toBe("stream_ta_r1.m3u8");
  });

  it("warms the rendition the player will start on, and the one below", () => {
    const { variants } = parseMaster(master);
    const heights = (longSide: number, estimate: number) =>
      renditionsFor(variants, longSide, estimate).map((v) => v.height);
    expect(heights(1200, 5_000_000)).toEqual([426, 1282]);
    expect(heights(1800, 5_000_000)).toEqual([1282, 1920]);
    // The link cannot carry 1080p: the best it can, never a guess above it.
    expect(heights(1800, 600_000)).toEqual([426, 1282]);
    expect(renditionsFor([], 900, 5_000_000)).toEqual([]);
  });

  it("starts on the smallest rung that covers the screen, within the link", () => {
    const rungs = [
      { width: 1080, height: 1920, bitrate: 3_000_000 },
      { width: 240, height: 426, bitrate: 200_000 },
      { width: 720, height: 1282, bitrate: 1_500_000 },
    ];
    expect(pickStartLevel(rungs, 1200, 5_000_000)).toBe(2);
    expect(pickStartLevel(rungs, 1900, 5_000_000)).toBe(0);
    expect(pickStartLevel(rungs, 1900, 1_000_000)).toBe(1);
    expect(pickStartLevel(rungs, 1900, 100_000)).toBe(1);
    expect(pickStartLevel([], 1900, 5_000_000)).toBe(-1);
  });

  it("takes the init segment and the first fragments only", () => {
    const media = [
      "#EXTM3U",
      '#EXT-X-MAP:URI="../../video/1282/init.mp4"',
      "#EXTINF:4,",
      "../../video/1282/seg_1.mp4",
      "#EXTINF:4,",
      "../../video/1282/seg_2.mp4",
      "#EXTINF:4,",
      "../../video/1282/seg_3.mp4",
    ].join("\n");
    expect(parseMedia(media)).toEqual([
      "../../video/1282/init.mp4",
      "../../video/1282/seg_1.mp4",
      "../../video/1282/seg_2.mp4",
    ]);
  });
});
