import { describe, expect, it } from "vitest";

import {
  EDGE_FLOW,
  edgeFlowing,
  edgeParticles,
  edgePoint,
} from "../src/features/q-swarm/edge-flow";
import {
  isWorkingState,
  QUIET_SOUNDS,
  soundAllowed,
  WORKING_TONE_AFTER_MS,
} from "../src/features/q-sound/sound-rules";

describe("presence while Q works (ADR 0062)", () => {
  it("flows only while Q is thinking or working", () => {
    expect(edgeFlowing("THINKING")).toBe(true);
    expect(edgeFlowing("WORKING")).toBe(true);
    for (const state of [
      "IDLE",
      "LISTENING",
      "SPEAKING",
      "NEEDS_APPROVAL",
      "COMPLETE",
    ] as const) {
      expect(edgeFlowing(state)).toBe(false);
    }
  });

  it("walks the inset perimeter clockwise", () => {
    expect(edgePoint(0, 200, 100, 0)).toEqual([0, 0]);
    expect(edgePoint(0.25, 200, 100, 0)).toEqual([150, 0]);
    expect(edgePoint(0.5, 200, 100, 0)).toEqual([200, 100]);
    expect(edgePoint(0.75, 200, 100, 0)).toEqual([50, 100]);
    expect(edgePoint(1.25, 200, 100, 0)).toEqual([150, 0]);
  });

  it("is deterministic in time and stays on the edge", () => {
    const a = edgeParticles(5_000, 800, 600);
    const b = edgeParticles(5_000, 800, 600);
    expect(a).toEqual(b);
    expect(a).toHaveLength(EDGE_FLOW.count);
    const inset = EDGE_FLOW.insetPx;
    for (const p of a) {
      const onEdge =
        Math.abs(p.x - inset) < 1e-6 ||
        Math.abs(p.x - (800 - inset)) < 1e-6 ||
        Math.abs(p.y - inset) < 1e-6 ||
        Math.abs(p.y - (600 - inset)) < 1e-6;
      expect(onEdge).toBe(true);
    }
    // Moving: a later moment is a different place.
    expect(edgeParticles(9_000, 800, 600)).not.toEqual(a);
  });

  it("never moves under reduced motion", () => {
    expect(edgeParticles(0, 800, 600, true)).toEqual(
      edgeParticles(60_000, 800, 600, true),
    );
  });

  it("plays the working tone at 0.7 s on On and Quiet, never on Off or over Q's voice", () => {
    expect(WORKING_TONE_AFTER_MS).toBe(700);
    expect(isWorkingState("WORKING")).toBe(true);
    expect(isWorkingState("SPEAKING")).toBe(false);
    expect(QUIET_SOUNDS.has("working")).toBe(true);
    const base = {
      speaking: false,
      pathname: "/home",
      reducedMotion: true,
      reducedTransparency: false,
      now: 10_000,
      lastAt: null,
    };
    expect(soundAllowed("working", { ...base, mode: "ON" })).toBe(true);
    expect(soundAllowed("working", { ...base, mode: "QUIET" })).toBe(true);
    expect(soundAllowed("working", { ...base, mode: "OFF" })).toBe(false);
    expect(
      soundAllowed("working", { ...base, mode: "ON", speaking: true }),
    ).toBe(false);
    expect(
      soundAllowed("working", { ...base, mode: "ON", pathname: "/discover" }),
    ).toBe(false);
  });
});
