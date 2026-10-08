// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The warm card's byte budget (doc 20 §51 as amended by ADR 0063): hls.js
 * buffers the larger of `maxBufferLength` and what 60 MB holds, capped only
 * by `maxMaxBufferLength`, so the cap is what bounds a warm card's start.
 * The playing card's engine is raised in place, never re-attached, to the
 * whole pitch, so its loop never goes back to the network.
 */

type Config = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  startFragPrefetch?: boolean;
  testBandwidth?: boolean;
  backBufferLength?: number;
  abrEwmaDefaultEstimate?: number;
};
const created: Config[] = [];

vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      return true;
    }
    static Events = { ERROR: "hlsError" };
    readonly config: Config;
    constructor(config: Config) {
      this.config = { ...config };
      created.push(this.config);
    }
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy() {}
  }
  return { default: FakeHls };
});

const { attachHlsOrNativeSource, setStreamWarmth, BUFFER_SECONDS } =
  await import("../src/features/discover/player/hls-source");
const WARM = {
  maxBufferLength: BUFFER_SECONDS.warm.ahead,
  maxMaxBufferLength: BUFFER_SECONDS.warm.cap,
};
const ACTIVE = {
  maxBufferLength: BUFFER_SECONDS.active.ahead,
  maxMaxBufferLength: BUFFER_SECONDS.active.cap,
};

function video(): HTMLVideoElement {
  const element = document.createElement("video");
  // jsdom plays nothing natively, which is the hls.js path.
  element.canPlayType = () => "";
  return element;
}

async function settle() {
  await vi.waitFor(() => expect(created.length).toBeGreaterThan(0));
}

afterEach(() => {
  created.length = 0;
});

describe("a stream's buffer by the controller's tier", () => {
  it("buffers a bounded start for a warm card, fetching the first fragment early", async () => {
    const element = video();
    const detach = attachHlsOrNativeSource(
      element,
      "https://cdn.test/t/manifest/video.m3u8",
    );
    await settle();
    expect(created[0]).toMatchObject({ ...WARM, startFragPrefetch: true });
    // Enough to start at once and keep going; never the whole pitch.
    expect(BUFFER_SECONDS.warm.ahead).toBeGreaterThanOrEqual(8);
    expect(BUFFER_SECONDS.warm.cap).toBeLessThanOrEqual(15);
    detach();
  });

  it("raises the same engine when the card becomes the one playing, and lowers it again", async () => {
    const element = video();
    const detach = attachHlsOrNativeSource(
      element,
      "https://cdn.test/t/manifest/video.m3u8",
    );
    await settle();
    setStreamWarmth(element, "active");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject(ACTIVE);
    setStreamWarmth(element, "warm");
    expect(created[0]).toMatchObject(WARM);
    detach();
  });

  it("starts an engine at the tier asked for before it loaded", async () => {
    const element = video();
    setStreamWarmth(element, "active");
    const detach = attachHlsOrNativeSource(
      element,
      "https://cdn.test/t/manifest/video.m3u8",
    );
    await settle();
    expect(created[0]).toMatchObject(ACTIVE);
    detach();
  });

  it("never starts at the lowest rung to test the link, and keeps what was played", async () => {
    // The measured cause of "Slow connection" on every pitch (2026-10-08):
    // hls.js's testBandwidth loaded the 240p rendition first.
    const element = video();
    const detach = attachHlsOrNativeSource(
      element,
      "https://cdn.test/t/manifest/video.m3u8",
    );
    await settle();
    expect(created[0]?.testBandwidth).toBe(false);
    expect(created[0]?.abrEwmaDefaultEstimate).toBeGreaterThanOrEqual(
      1_000_000,
    );
    expect(created[0]?.backBufferLength).toBe(Infinity);
    // The engine, not the element, loops a stream (see loopStart).
    expect(element.loop).toBe(false);
    detach();
  });

  it("uses the engine where MSE exists even if the browser plays HLS itself", async () => {
    // Chrome now plays HLS natively, from 240p, around the cache.
    const element = video();
    element.canPlayType = () => "maybe";
    vi.stubGlobal("MediaSource", { isTypeSupported: () => true });
    const detach = attachHlsOrNativeSource(
      element,
      "https://cdn.test/t/manifest/video.m3u8",
    );
    await settle();
    expect(element.getAttribute("src")).toBeNull();
    detach();
    vi.unstubAllGlobals();
  });

  it("leaves HLS to the browser where there is no MSE (the iPhone)", () => {
    const element = video();
    element.canPlayType = () => "maybe";
    const url = "https://cdn.test/t/manifest/video.m3u8";
    const detach = attachHlsOrNativeSource(element, url);
    expect(element.getAttribute("src")).toBe(url);
    expect(created).toHaveLength(0);
    detach();
  });
});
