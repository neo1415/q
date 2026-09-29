import { describe, expect, it } from "vitest";

import { modeFor } from "../src/features/q-swarm/q-swarm";
import {
  faceShape,
  qShape,
  ringShape,
} from "../src/features/q-swarm/swarm-shapes";

/**
 * The particle presence (founder direction 2026-09-29): what the swarm
 * forms is read from Q's real state, and every shape fills the swarm.
 */
describe("what the swarm forms", () => {
  it("is a face while Q listens, thinks, speaks or asks, on a surface large enough to read one", () => {
    for (const [state, activity] of [
      ["LISTENING", "LISTENING"],
      ["THINKING", "THINKING"],
      ["SPEAKING", "SPEAKING"],
      ["NEEDS_INPUT", "ASKING"],
    ] as const) {
      expect(modeFor(state, false, 0, null, null)).toMatchObject({
        mode: "FACE",
        activity,
      });
      // Too small for a face: the Q, or the ring while thinking.
      expect(modeFor(state, true, 0, null, null).mode).not.toBe("FACE");
    }
  });

  it("runs the ring while working, laughs on a laugh, and shows a glyph it is given", () => {
    expect(modeFor("WORKING", false, 0, null, null).mode).toBe("RING");
    expect(modeFor("SPEAKING", false, 0, "LAUGH", null).activity).toBe(
      "LAUGHING",
    );
    expect(modeFor("IDLE", false, 0, null, "👋")).toMatchObject({
      mode: "GLYPH",
      glyph: "👋",
    });
    expect(modeFor("ERROR", false, 0, null, null).dim).toBe(true);
  });

  it("rests as the Q and now and then becomes a face that looks around", () => {
    expect(modeFor("IDLE", false, 1_000, null, null).mode).toBe("Q");
    expect(modeFor("IDLE", false, 16_000, null, null).mode).toBe("FACE");
    expect(modeFor("IDLE", true, 16_000, null, null).mode).toBe("Q");
  });

  it("gives every particle a point in every shape, with a brain in each face", () => {
    for (const shape of [
      qShape(500),
      ringShape(500),
      faceShape("FEMALE", 500),
      faceShape("MALE", 500),
    ]) {
      expect(shape).toHaveLength(500);
    }
    expect(faceShape("MALE", 500).some((p) => p.part === "BRAIN")).toBe(true);
    expect(faceShape("FEMALE", 500).some((p) => p.part === "MOUTH_LOWER")).toBe(
      true,
    );
  });
});
