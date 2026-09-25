import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ApertureAnimator,
  FLASH_MS,
  needsFrames,
  RING_RADIUS,
  SETTLE_MS,
  sweepAt,
  targetParams,
  type FrameInputs,
} from "../src/features/q-aperture/aperture-frame";
import {
  apertureStateFor,
  apertureStateFromVoice,
  Q_APERTURE_LABELS,
  Q_APERTURE_STATES,
} from "../src/features/q-aperture/aperture-state";

/**
 * The Q Aperture's rules (ADR 0017 F2; spec §5, §15 UX-02), asserted in
 * code rather than by eye: states come from real signals, nothing animates
 * at rest, the sweep quietens by 5 s, Calm and Off are static, and the
 * ring's colours hold 3:1 against every surface it sits on.
 */

const at = (
  elapsedMs: number,
  motion: FrameInputs["motion"] = "full",
): FrameInputs => ({
  input: 0,
  output: 0,
  progress: null,
  elapsedMs,
  motion,
  bloom: true,
});

describe("aperture state", () => {
  it("names every state, and every voice state has one", () => {
    for (const state of Q_APERTURE_STATES) {
      expect(Q_APERTURE_LABELS[state].length).toBeGreaterThan(0);
    }
    expect(apertureStateFromVoice("INTERRUPTED")).toBe("LISTENING");
    expect(apertureStateFromVoice("CONNECTING")).toBe("THINKING");
    expect(apertureStateFromVoice("Q_SPEAKING")).toBe("SPEAKING");
  });

  it("derives the state from real signals, voice first, approval before work", () => {
    const quiet = { voice: null, working: false, failed: false } as const;
    expect(apertureStateFor(quiet)).toBe("IDLE");
    expect(apertureStateFor({ ...quiet, working: true })).toBe("THINKING");
    expect(
      apertureStateFor({ ...quiet, working: true, approvalPending: true }),
    ).toBe("NEEDS_APPROVAL");
    expect(apertureStateFor({ ...quiet, acting: true })).toBe("WORKING");
    expect(apertureStateFor({ ...quiet, settled: true })).toBe("COMPLETE");
    expect(apertureStateFor({ ...quiet, failed: true })).toBe("ERROR");
    expect(
      apertureStateFor({ ...quiet, voice: "LISTENING", working: true }),
    ).toBe("LISTENING");
    expect(
      apertureStateFor({ ...quiet, voice: "LISTENING", asking: true }),
    ).toBe("NEEDS_INPUT");
  });
});

describe("aperture motion", () => {
  it("needs no frames at rest: idle, static states, and a new aperture", () => {
    const none = { input: false, output: false };
    for (const state of [
      "IDLE",
      "NEEDS_INPUT",
      "NEEDS_APPROVAL",
      "ERROR",
    ] as const) {
      expect(needsFrames(state, at(SETTLE_MS), none)).toBe(false);
    }
    // Listening or speaking with no level to follow is still.
    expect(needsFrames("LISTENING", at(SETTLE_MS), none)).toBe(false);
    const animator = new ApertureAnimator("IDLE", 1000);
    expect(
      animator.frame(1000, { progress: null, motion: "full", bloom: true })
        .live,
    ).toBe(false);
  });

  it("moves only while work, audio or a state change is live", () => {
    const levels = { input: true, output: true };
    expect(needsFrames("THINKING", at(10_000), levels)).toBe(true);
    expect(needsFrames("LISTENING", at(10_000), levels)).toBe(true);
    expect(needsFrames("IDLE", at(SETTLE_MS / 2), levels)).toBe(true);
    expect(needsFrames("IDLE", at(SETTLE_MS), levels)).toBe(false);
  });

  it("quietens the sweep by 5.0 s without the head jumping", () => {
    expect(sweepAt(1000).amplitude).toBe(1);
    expect(sweepAt(4300).amplitude).toBe(1);
    expect(sweepAt(5000).amplitude).toBeCloseTo(0.35, 5);
    expect(sweepAt(4700).amplitude).toBeLessThan(1);
    const before = sweepAt(4999.9).phase;
    const after = sweepAt(5000.1).phase;
    expect(Math.abs(after - before)).toBeLessThan(0.001);
    // After 5 s a turn takes 6 s.
    const a = sweepAt(6000).phase;
    const b = sweepAt(9000).phase;
    expect((b - a + 1) % 1).toBeCloseTo(0.5, 5);
  });

  it("is static under Calm and Off: no frames, no sweep, no audio scale", () => {
    const levels = { input: true, output: true };
    for (const motion of ["calm", "off"] as const) {
      for (const state of Q_APERTURE_STATES) {
        expect(needsFrames(state, at(0, motion), levels)).toBe(false);
      }
      const thinking = targetParams("THINKING", at(1000, motion));
      expect(thinking.sweepAmp).toBe(0);
      const listening = targetParams("LISTENING", {
        ...at(1000, motion),
        input: 1,
      });
      expect(listening.radius).toBe(RING_RADIUS);
    }
    expect(targetParams("IDLE", at(0, "off")).bloom).toBe(0);
  });

  it("opens by at most 6% to listen and tightens to think", () => {
    const loud = targetParams("LISTENING", { ...at(1000), input: 1 });
    expect(loud.radius).toBeCloseTo(RING_RADIUS * 1.06, 6);
    expect(targetParams("THINKING", at(1000)).radius).toBeLessThan(RING_RADIUS);
  });

  it("flashes once on completion, for 240 ms, and never under Calm", () => {
    expect(targetParams("COMPLETE", at(0)).flash).toBe(1);
    expect(targetParams("COMPLETE", at(FLASH_MS)).flash).toBe(0);
    expect(targetParams("COMPLETE", at(0, "calm")).flash).toBe(0);
    const none = { input: false, output: false };
    expect(needsFrames("COMPLETE", at(FLASH_MS + SETTLE_MS), none)).toBe(false);
  });

  it("settles a state change from where the light is, then stops", () => {
    const animator = new ApertureAnimator("IDLE", 0);
    animator.frame(0, { progress: null, motion: "full", bloom: true });
    animator.setState("ERROR", 1000);
    const mid = animator.frame(1000 + SETTLE_MS / 2, {
      progress: null,
      motion: "full",
      bloom: true,
    });
    expect(mid.live).toBe(true);
    expect(mid.params.ember).toBeGreaterThan(0);
    expect(mid.params.ember).toBeLessThan(1);
    const end = animator.frame(1000 + SETTLE_MS, {
      progress: null,
      motion: "full",
      bloom: true,
    });
    expect(end.params.ember).toBe(1);
    expect(end.live).toBe(false);
  });
});

// ---- Contrast (WCAG 1.4.11): the ring against every surface it sits on.

const TOKENS = readFileSync(
  fileURLToPath(
    new URL("../../../packages/ui/src/tokens/tokens.css", import.meta.url),
  ),
  "utf8",
);

type Rgba = readonly [number, number, number, number];

/** OKLCH → sRGB (0..1, gamma-encoded) with alpha. */
function oklch(value: string): Rgba {
  const match =
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(
      value,
    );
  if (match === null) throw new Error(`not an oklch colour: ${value}`);
  const [L, C, H] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  const encode = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return [
    encode(linear[0] ?? 0),
    encode(linear[1] ?? 0),
    encode(linear[2] ?? 0),
    alpha,
  ];
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const [r, g, b, a] = top;
  return [
    r * a + bottom[0] * (1 - a),
    g * a + bottom[1] * (1 - a),
    b * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance(colour: Rgba): number {
  const decode = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * decode(colour[0]) +
    0.7152 * decode(colour[1]) +
    0.0722 * decode(colour[2])
  );
}

function contrast(x: Rgba, y: Rgba): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** A token's value inside the first block that starts at `anchor`. */
function token(anchor: string, name: string): Rgba {
  const start = TOKENS.indexOf(anchor);
  if (start < 0) throw new Error(`no block ${anchor}`);
  const block = TOKENS.slice(start, TOKENS.indexOf("\n}", start));
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (match?.[1] === undefined) throw new Error(`no --${name} in ${anchor}`);
  return oklch(match[1]);
}

describe("aperture contrast", () => {
  const light = ":root {";
  const dark = ':root[data-theme="dark"] {';
  const themes = [
    { anchor: light, name: "light" },
    { anchor: dark, name: "dark" },
  ];

  it.each(themes)(
    "holds 3:1 against the $name surfaces in every state",
    ({ anchor }) => {
      const canvas = token(anchor, "cq-canvas");
      const surfaces = [
        "cq-canvas",
        "cq-surface",
        "cq-surface-raised",
        "cq-surface-subtle",
      ].map((name) => over(token(anchor, name), canvas));
      // The ring is q-light in every state but error, which is q-ember.
      for (const ring of ["cq-q-light", "cq-q-ember"]) {
        for (const surface of surfaces) {
          expect(contrast(token(anchor, ring), surface)).toBeGreaterThanOrEqual(
            3,
          );
        }
      }
    },
  );

  it("holds 3:1 on the stage, which is one night in either theme", () => {
    const canvas = token(light, "cq-stage-canvas");
    const surfaces = [
      canvas,
      over(token(light, "cq-stage-surface"), canvas),
      over(token(light, "cq-stage-surface-strong"), canvas),
    ];
    for (const ring of ["cq-stage-q-light", "cq-stage-q-ember"]) {
      for (const surface of surfaces) {
        expect(contrast(token(light, ring), surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
