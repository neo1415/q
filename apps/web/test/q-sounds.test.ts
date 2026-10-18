// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { Q_APERTURE_STATES } from "../src/features/q-aperture/aperture-state";
import { HUM, SOUND_RECIPES } from "../src/features/q-sound/sound-engine";
import {
  readSoundPreference,
  SOUND_PREFERENCE_KEY,
  storeSoundPreference,
} from "../src/features/q-sound/sound-preference";
import {
  cueForTransition,
  DEFAULT_SOUND_MODE,
  HUM_MAX_MS,
  inSwipePath,
  MIN_GAP_MS,
  parseSoundMode,
  Q_SOUNDS,
  soundAllowed,
  type SoundContext,
} from "../src/features/q-sound/sound-rules";

/**
 * I2: Q's sounds play only for real state changes, never while Q speaks
 * or in Discover's swipe path, at most one every 0.6 s, and only as much
 * as the person's On / Quiet / Off allows.
 */

const base: SoundContext = {
  mode: "ON",
  speaking: false,
  pathname: "/home",
  reducedMotion: false,
  reducedTransparency: false,
  now: 10_000,
  lastAt: null,
};

describe("which sound for which change of state", () => {
  it("never sounds on arrival or when nothing changed", () => {
    for (const state of Q_APERTURE_STATES) {
      expect(cueForTransition(null, state)).toEqual({ play: null, hum: null });
      expect(cueForTransition(state, state)).toEqual({ play: null, hum: null });
    }
  });

  it("wakes from rest, opens and closes the microphone", () => {
    expect(cueForTransition("IDLE", "LISTENING").play).toBe("wake");
    expect(cueForTransition("COMPLETE", "LISTENING").play).toBe("wake");
    expect(cueForTransition("SPEAKING", "LISTENING").play).toBe("listenOn");
    expect(cueForTransition("LISTENING", "THINKING").play).toBe("listenOff");
    expect(cueForTransition("LISTENING", "IDLE").play).toBe("listenOff");
  });

  it("hums while Q thinks or works, and stops for any other state", () => {
    expect(cueForTransition("IDLE", "THINKING").hum).toBe("START");
    expect(cueForTransition("LISTENING", "WORKING").hum).toBe("START");
    // Thinking into working keeps the one hum going.
    expect(cueForTransition("THINKING", "WORKING").hum).toBeNull();
    for (const next of [
      "SPEAKING",
      "COMPLETE",
      "ERROR",
      "IDLE",
      "NEEDS_APPROVAL",
    ] as const) {
      expect(cueForTransition("THINKING", next).hum).toBe("STOP");
    }
  });

  it("pings a result, knocks for an approval, and marks an error", () => {
    expect(cueForTransition("THINKING", "COMPLETE").play).toBe("ping");
    expect(cueForTransition("WORKING", "NEEDS_APPROVAL").play).toBe("needs");
    expect(cueForTransition("WORKING", "NEEDS_INPUT").play).toBe("needs");
    expect(cueForTransition("THINKING", "ERROR").play).toBe("error");
    expect(cueForTransition("THINKING", "SPEAKING").play).toBeNull();
  });
});

describe("when a sound may play", () => {
  it("plays nothing while Q speaks, in Discover's swipe path, or when Off", () => {
    for (const sound of Q_SOUNDS) {
      expect(soundAllowed(sound, { ...base, speaking: true })).toBe(false);
      expect(soundAllowed(sound, { ...base, pathname: "/discover" })).toBe(
        false,
      );
      expect(soundAllowed(sound, { ...base, pathname: "/discover/abc" })).toBe(
        false,
      );
      expect(soundAllowed(sound, { ...base, mode: "OFF" })).toBe(false);
    }
    expect(inSwipePath("/discovery-notes")).toBe(false);
  });

  it("keeps only Result ready, Needs you and errors on Quiet", () => {
    const quiet = { ...base, mode: "QUIET" as const };
    expect(soundAllowed("ping", quiet)).toBe(true);
    expect(soundAllowed("needs", quiet)).toBe(true);
    expect(soundAllowed("error", quiet)).toBe(true);
    for (const sound of [
      "wake",
      "listenOn",
      "listenOff",
      "hum",
      "sent",
    ] as const) {
      expect(soundAllowed(sound, quiet)).toBe(false);
    }
  });

  it("drops a sound within 0.6 s of the last, rather than queueing it", () => {
    expect(
      soundAllowed("ping", { ...base, lastAt: base.now - MIN_GAP_MS + 1 }),
    ).toBe(false);
    expect(
      soundAllowed("ping", { ...base, lastAt: base.now - MIN_GAP_MS }),
    ).toBe(true);
  });

  it("hums only on the Q page, and not for someone who asks for a calmer screen", () => {
    expect(soundAllowed("hum", base)).toBe(true);
    expect(soundAllowed("hum", { ...base, pathname: "/relationships" })).toBe(
      false,
    );
    expect(soundAllowed("hum", { ...base, reducedMotion: true })).toBe(false);
    expect(soundAllowed("hum", { ...base, reducedTransparency: true })).toBe(
      false,
    );
    // The short sounds still play for them.
    expect(soundAllowed("ping", { ...base, reducedMotion: true })).toBe(true);
    expect(HUM_MAX_MS).toBe(20_000);
  });
});

describe("the sounds themselves", () => {
  it("are quiet and short: peaks at or below -18 dBFS, under a second", () => {
    for (const parts of Object.values(SOUND_RECIPES)) {
      for (const part of parts) {
        expect(part.peak).toBeLessThanOrEqual(-18);
        expect(part.at + part.length).toBeLessThanOrEqual(1);
      }
    }
    expect(HUM.peak).toBeLessThanOrEqual(-30);
  });
});

describe("the On / Quiet / Off setting", () => {
  afterEach(() => window.localStorage.clear());

  it("starts on Quiet and remembers the choice on this device", () => {
    expect(DEFAULT_SOUND_MODE).toBe("QUIET");
    expect(readSoundPreference()).toBe("QUIET");
    storeSoundPreference("OFF");
    expect(readSoundPreference()).toBe("OFF");
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, "LOUD");
    expect(readSoundPreference()).toBe("QUIET");
    expect(parseSoundMode("ON")).toBe("ON");
  });
});
