import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Hls from "hls.js";
import { describe, expect, it } from "vitest";

/**
 * A pitch's sound reaches the speaker (founder 2026-10-08: "volume is up
 * but no sound comes out").
 *
 * Cloudflare Stream serves the audio as its own rendition
 * (`#EXT-X-MEDIA:TYPE=AUDIO`), so the engine must be the build that plays
 * alternate audio. hls.js's light build has no audio stream controller and
 * played every pitch silent on Discover and Explore alike.
 */

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the stream engine plays the pitch's audio rendition", () => {
  it("is the hls.js build with an audio stream controller", () => {
    expect(Hls.DefaultConfig.audioStreamController).toBeDefined();
    expect(Hls.DefaultConfig.audioTrackController).toBeDefined();
  });

  it("is what the player and the warm-up load, never the light build", () => {
    for (const file of [
      "../src/features/discover/player/hls-source.ts",
      "../src/features/discover/player/pitch-warmup-trigger.tsx",
    ]) {
      const text = source(file);
      expect(text).toContain('import("hls.js")');
      expect(text).not.toContain('"hls.js/light"');
    }
  });
});
