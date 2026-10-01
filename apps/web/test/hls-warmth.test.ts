// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The warm card's byte budget (doc 20 §51; harden spec §2): hls.js buffers
 * the larger of `maxBufferLength` and what 60 MB holds, capped only by
 * `maxMaxBufferLength`, so the cap is what keeps a warm card to a short
 * start. The playing card's engine is raised in place, never re-attached.
 */

type Config = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  startFragPrefetch?: boolean;
};
const created: Config[] = [];

vi.mock("hls.js/light", () => {
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

const { attachHlsOrNativeSource, setStreamWarmth } =
  await import("../src/features/discover/player/hls-source");

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
  it("buffers only a short start for a warm card, fetching the first fragment early", async () => {
    const element = video();
    const detach = attachHlsOrNativeSource(
      element,
      "https://cdn.test/t/manifest/video.m3u8",
    );
    await settle();
    expect(created[0]).toMatchObject({
      maxBufferLength: 4,
      maxMaxBufferLength: 6,
      startFragPrefetch: true,
    });
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
    expect(created[0]).toMatchObject({
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });
    setStreamWarmth(element, "warm");
    expect(created[0]).toMatchObject({
      maxBufferLength: 4,
      maxMaxBufferLength: 6,
    });
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
    expect(created[0]).toMatchObject({
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });
    detach();
  });
});
