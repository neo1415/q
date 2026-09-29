import { describe, expect, it } from "vitest";

import { pointTargetFor } from "../src/features/q-swarm/point-target";
import {
  choreograph,
  cueForSentence,
  MAX_HOLD_SECONDS,
  SEQUENCES,
} from "../src/features/q-swarm/swarm-choreography";
import {
  bloomShape,
  faceShape,
  galaxyShape,
  mouthShape,
  qShape,
  ringShape,
  waveShape,
} from "../src/features/q-swarm/swarm-shapes";

/**
 * The particle presence (founder live 2026-09-29): never one shape for
 * more than ten seconds, figures that follow Q's state, and what Q says
 * shown as it is said.
 */
const at = (
  state: Parameters<typeof choreograph>[0]["state"],
  seconds: number,
  small = false,
) => choreograph({ state, small, now: seconds * 1000, since: 0, cue: null });

describe("what the swarm forms", () => {
  it("never holds a figure longer than the limit, in any state", () => {
    for (const sequence of Object.values(SEQUENCES)) {
      for (const beat of sequence) {
        expect(beat.seconds).toBeLessThanOrEqual(MAX_HOLD_SECONDS);
      }
    }
  });

  it("moves through several figures while Q speaks, the face and the mouth among them", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 40; s += 1) seen.add(at("SPEAKING", s).mode);
    expect(seen.has("FACE")).toBe(true);
    expect(seen.has("MOUTH")).toBe(true);
    expect(seen.has("WAVE")).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it("starts a new state at the top of its sequence", () => {
    expect(
      choreograph({
        state: "THINKING",
        small: false,
        now: 50_000,
        since: 50_000,
        cue: null,
      }),
    ).toMatchObject({
      mode: SEQUENCES.THINKING[0]?.mode,
      activity: SEQUENCES.THINKING[0]?.activity,
    });
  });

  it("keeps faces off surfaces too small to read one", () => {
    for (const state of ["SPEAKING", "LISTENING", "IDLE"] as const) {
      for (let s = 0; s < 40; s += 1) {
        expect(["FACE", "MOUTH", "GLYPH", "WAVE"]).not.toContain(
          at(state, s, true).mode,
        );
      }
    }
  });

  it("takes a laugh or a glyph from Q's own sentence, then hands the swarm back", () => {
    const laugh = cueForSentence("Because they wanted a better round! 😄", 0);
    expect(laugh?.laugh).toBe(true);
    const during = choreograph({
      state: "SPEAKING",
      small: false,
      now: 100,
      since: 0,
      cue: laugh,
    });
    expect(during.activity).toBe("LAUGHING");
    const after = choreograph({
      state: "SPEAKING",
      small: false,
      now: 10_000,
      since: 0,
      cue: laugh,
    });
    expect(after.activity).not.toBe("LAUGHING");
    expect(cueForSentence("Your revenue grew last quarter.", 0)?.glyph).toBe(
      "💰",
    );
    expect(cueForSentence("Okay.", 0)).toBeNull();
  });

  it("is often a formless mass, in every state large enough to show one", () => {
    for (const state of [
      "IDLE",
      "LISTENING",
      "THINKING",
      "SPEAKING",
    ] as const) {
      expect(SEQUENCES[state].some((b) => b.mode === "FORMLESS")).toBe(true);
    }
  });

  it("gives every particle a point in every shape", () => {
    for (const shape of [
      qShape(500),
      ringShape(500),
      mouthShape(500),
      waveShape(500),
      galaxyShape(500),
      bloomShape(500),
      faceShape("FEMALE", 500),
      faceShape("MALE", 500),
    ]) {
      expect(shape).toHaveLength(500);
    }
    expect(faceShape("MALE", 500).some((p) => p.part === "BRAIN")).toBe(true);
  });
});

describe("where the swarm points on the page", () => {
  const element = (name: string) => ({ name }) as unknown as Element;

  it("finds the control Q names, preferring the longer label", () => {
    const call = element("call");
    const book = element("book");
    expect(
      pointTargetFor("You can Book a call from here.", [
        { label: "Call", element: call },
        { label: "Book a call", element: book },
      ]),
    ).toBe(book);
  });

  it("matches whole words only, and nothing when nothing is named", () => {
    expect(
      pointTargetFor("That is discoverable.", [
        { label: "Discover", element: element("d") },
      ]),
    ).toBeNull();
  });
});
