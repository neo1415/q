import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BLACK_GOLD,
  presetPaperStage,
  presetStyleSheet,
} from "@/features/brand-theme/brand-presets";
import {
  NIGHT_LIGHTING,
  PAPER_LIGHTING,
  presenceLighting,
} from "@/features/q-swarm/presence-uniforms";

/**
 * The Q stage follows the theme (owner 2026-10-20: "how come the Q page
 * and some other pages like that don't inherit the light and dark mode
 * stuff"). Light is paper, dark is the night it always was, and every
 * surface that frames a video stays the night in both themes (the
 * cinema). Every text and control on the stage keeps WCAG AA in both.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const TOKENS = read("../../../packages/ui/src/tokens/tokens.css");
const GLOBALS = read("../app/globals.css");

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

/** #rrggbb or #rrggbbaa → sRGB 0..1 with alpha. */
function hex(value: string): Rgba {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/u.exec(value);
  if (match?.[1] === undefined) throw new Error(`not a hex colour: ${value}`);
  const n = Number.parseInt(match[1], 16);
  const alpha =
    match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255;
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
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

/** The text of the first block that starts at `anchor`. */
function block(css: string, anchor: string): string {
  const start = css.indexOf(anchor);
  if (start < 0) throw new Error(`no block ${anchor}`);
  return css.slice(start, css.indexOf("}", start));
}

const ROOT = block(TOKENS, ":root {");
const DARK = block(TOKENS, ':root[data-theme="dark"] {');
const DEVICE_DARK = block(TOKENS, ':root:not([data-theme="light"]) {');

/** A token's raw value in a block, var(--x) resolved against :root. */
function raw(source: string, name: string): string {
  const match = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "mu").exec(source);
  if (match?.[1] === undefined) throw new Error(`no --${name}`);
  const value = match[1].trim();
  const reference = /^var\(--([a-z-]+)\)$/u.exec(value);
  return reference?.[1] === undefined ? value : raw(ROOT, reference[1]);
}

/** The stage as the classic theme resolves it, opaque over its canvas. */
function classicStage(source: string) {
  const colour = (name: string) => oklch(raw(source, `cq-stage-${name}`));
  const canvas = colour("canvas");
  const on = (name: string) => over(colour(name), canvas);
  return {
    canvas,
    surface: on("surface"),
    surfaceStrong: on("surface-strong"),
    border: on("border"),
    text: on("text"),
    muted: on("text-muted"),
    accent: on("accent"),
    star: on("star"),
    veil: on("veil"),
    qLight: on("q-light"),
    qEmber: on("q-ember"),
  };
}

/** The black-and-gold preset's stage, paper or night, opaque over its canvas. */
function goldStage(mode: "paper" | "night") {
  const palette = BLACK_GOLD.palette;
  if (palette === null) throw new Error("palette");
  if (mode === "paper") {
    const paper = presetPaperStage(palette.light);
    const colour = (name: string) => {
      const value = paper[name];
      if (value === undefined) throw new Error(`no paper ${name}`);
      return hex(value);
    };
    const canvas = colour("canvas");
    const on = (name: string) => over(colour(name), canvas);
    return {
      canvas,
      surface: on("surface"),
      surfaceStrong: on("surface-strong"),
      border: on("border"),
      text: on("text"),
      muted: on("text-muted"),
      accent: on("accent"),
      star: on("star"),
      veil: on("veil"),
      qLight: on("q-light"),
      qEmber: on("q-ember"),
    };
  }
  // The night keeps tokens.css's whites over the preset's own night canvas.
  const canvas = hex(palette.stage.canvas);
  const on = (value: Rgba) => over(value, canvas);
  const night = (name: string) => on(oklch(raw(ROOT, `cq-night-${name}`)));
  return {
    canvas,
    surface: night("surface"),
    surfaceStrong: night("surface-strong"),
    border: night("border"),
    text: night("text"),
    muted: night("text-muted"),
    accent: on(hex(palette.stage.accent)),
    star: night("star"),
    veil: night("veil"),
    qLight: on(hex(palette.stage.qLight)),
    qEmber: on(hex(palette.stage.qEmber)),
  };
}

type Stage = ReturnType<typeof classicStage>;

/** Every pairing the stage's text and controls draw (globals.css). */
function assertStageContrast(stage: Stage) {
  const failing: string[] = [];
  const need = (name: string, fg: Rgba, bg: Rgba, min: number) => {
    const ratio = contrast(fg, bg);
    if (ratio < min) failing.push(`${name} ${ratio.toFixed(2)}`);
  };
  const wells = {
    canvas: stage.canvas,
    surface: over(stage.surface, stage.canvas),
    "surface-strong": over(stage.surfaceStrong, stage.canvas),
    veil: stage.veil,
  };
  for (const [well, ground] of Object.entries(wells)) {
    need(`text on ${well}`, stage.text, ground, 4.5);
    need(`muted text on ${well}`, stage.muted, ground, 4.5);
  }
  // .cq-stage-primary and .cq-stage-control.is-active: canvas on text.
  need("primary label", stage.canvas, stage.text, 4.5);
  // Room-talk's ring, the selected option and the focused field (1.4.11).
  need("accent edge on canvas", stage.accent, stage.canvas, 3);
  need("accent edge on a well", stage.accent, wells.surface, 3);
  // Q's light and its error ember, on the stage and its wells (1.4.11).
  for (const [ground, value] of Object.entries(wells)) {
    if (ground === "veil") continue;
    need(`Q's light on ${ground}`, stage.qLight, value, 3);
    need(`Q's ember on ${ground}`, stage.qEmber, value, 3);
  }
  expect(failing).toEqual([]);
  // The stars are a whisper, far below the text they sit behind.
  expect(contrast(stage.star, stage.canvas)).toBeLessThan(
    contrast(stage.text, stage.canvas) / 3,
  );
}

describe("the Q stage follows the theme", () => {
  it("is paper in the light theme and the night in the dark theme", () => {
    const light = classicStage(ROOT);
    const dark = classicStage(DARK);
    expect(luminance(light.canvas)).toBeGreaterThan(0.85);
    expect(luminance(dark.canvas)).toBeLessThan(0.05);
    // Light text on paper is ink; dark text on the night is light.
    expect(luminance(light.text)).toBeLessThan(0.05);
    expect(luminance(dark.text)).toBeGreaterThan(0.85);
    // Q is ink on paper and light on the night.
    expect(raw(ROOT, "cq-stage-q-ink")).toBe("1");
    expect(raw(DARK, "cq-stage-q-ink")).toBe("0");
    expect(raw(ROOT, "cq-stage-scheme")).toBe("light");
    expect(raw(DARK, "cq-stage-scheme")).toBe("dark");
  });

  it("keeps today's night in dark mode, through the device's choice too", () => {
    // The values the stage held as one night in both themes (2026-10-19).
    const night: Record<string, string> = {
      canvas: "oklch(0.17 0.02 262)",
      text: "oklch(0.98 0.004 92)",
      "text-muted": "oklch(1 0 0 / 0.62)",
      accent: "oklch(0.76 0.14 258)",
      "q-light": "oklch(0.8 0.13 258)",
      "q-ember": "oklch(0.63 0.035 258)",
    };
    for (const [name, value] of Object.entries(night)) {
      expect(raw(DARK, `cq-stage-${name}`), name).toBe(value);
      expect(raw(DEVICE_DARK, `cq-stage-${name}`), name).toBe(value);
    }
  });

  it.each([
    ["light", ROOT],
    ["dark", DARK],
  ] as const)("keeps AA for text and controls in %s (classic)", (_, source) => {
    assertStageContrast(classicStage(source));
  });

  it.each(["paper", "night"] as const)(
    "keeps AA for text and controls on black and gold's %s",
    (mode) => {
      assertStageContrast(goldStage(mode));
    },
  );

  it("writes black and gold's paper stage for light and its night for dark", () => {
    const css = presetStyleSheet(BLACK_GOLD);
    const root = /^:root\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(root).toContain("--cq-stage-canvas:#f6f4ef;");
    expect(root).toContain("--cq-stage-accent:#8a6a12;");
    expect(root).toContain("--cq-night-canvas:#0b0a08;");
    expect(root).toContain("--cq-night-q-light:#e2b858;");
    // Dark never re-sets the stage: tokens.css points it at the night.
    expect(css.slice(css.indexOf("\n"))).not.toContain("--cq-stage-");
  });
});

describe("the cinema stays the night", () => {
  const cinema = block(GLOBALS, ".cq-cinema {");

  it("pins every stage token the theme changes", () => {
    const changed = [...DARK.matchAll(/--(cq-stage-[a-z-]+):/gu)].map(
      (match) => match[1],
    );
    expect(changed.length).toBeGreaterThan(10);
    for (const name of changed) {
      expect(cinema, name).toMatch(new RegExp(`--${String(name)}:`));
      // ...to the same value the dark theme gives it.
      expect(raw(cinema, String(name)), name).toBe(raw(DARK, String(name)));
    }
    expect(cinema).toContain("color-scheme: dark;");
  });

  it("lets the stage's own scheme and Q's ink follow the theme", () => {
    const stage = block(GLOBALS, ".cq-stage,\n");
    expect(stage).toContain("color-scheme: var(--cq-stage-scheme);");
    expect(stage).toContain("--cq-q-ink: var(--cq-stage-q-ink);");
    expect(stage).toContain("--cq-q-sweep: var(--cq-stage-q-sweep);");
  });

  const source = (path: string) => read(`../src/features/${path}`);

  it.each([
    "discover/stage/pitch-stage.tsx",
    "discover/stage/feed-skeleton.tsx",
    "discover/discover-tabs.tsx",
    "discover/your-companies.tsx",
    "discover/network/network-videos.tsx",
    "explore/explore-grid.tsx",
    "explore/explore-feed.tsx",
    "company/brief/elevator.tsx",
    "pitch/pitch-grid.tsx",
    "pitch/pitch-upload.tsx",
    "video-room/provider-video-room.tsx",
    "rehearsal/rehearsal-room.tsx",
    "landing/landing-page.tsx",
  ])("frames the video in %s in the cinema", (path) => {
    expect(source(path)).toContain("cq-cinema");
  });

  it.each([
    "q/q-conversation.tsx",
    "voice/voice-stage.tsx",
    "voice/voice-handover.tsx",
    "welcome/welcome-screen.tsx",
    "welcome/workspace-choice.tsx",
    "rehearsal/rehearsal-lobby.tsx",
  ])("leaves the Q stage in %s to the theme", (path) => {
    const text = source(path);
    expect(text).toContain('"cq-stage ');
    expect(text).not.toContain("cq-cinema");
  });

  it("keeps the rehearsal room on the theme and only its camera tiles dark", () => {
    const text = source("rehearsal/rehearsal-room.tsx");
    expect(text).toContain('className="cq-stage fixed inset-0');
    // The camera and the shared screen are video frames.
    expect(text.match(/cq-cinema/gu)?.length).toBe(2);
    // Labels over a tile are a veil of the tile's own field, never a dark
    // scrim on paper.
    expect(text).not.toContain("bg-(--cq-overlay)");
  });
});

describe("Q's presence on paper and on the night", () => {
  it("is additive light on the night", () => {
    expect(presenceLighting(true)).toBe(NIGHT_LIGHTING);
    expect(NIGHT_LIGHTING.blend).toBe("add");
    expect(NIGHT_LIGHTING.white).toBe(1);
    expect(NIGHT_LIGHTING.coreLight).toBe(true);
  });

  it("is ink on paper: normal blending, no whitening, a tight faint bloom", () => {
    expect(presenceLighting(false)).toBe(PAPER_LIGHTING);
    expect(PAPER_LIGHTING.blend).toBe("over");
    expect(PAPER_LIGHTING.white).toBe(0);
    expect(PAPER_LIGHTING.coreLight).toBe(false);
    // Ink needs a body light does not: heavier, never fainter than a floor.
    expect(PAPER_LIGHTING.weight).toBeGreaterThan(1);
    expect(PAPER_LIGHTING.floor).toBeGreaterThan(NIGHT_LIGHTING.floor);
    expect(PAPER_LIGHTING.halo).toBeGreaterThan(0);
    expect(PAPER_LIGHTING.halo).toBeLessThan(NIGHT_LIGHTING.halo / 2);
    expect(PAPER_LIGHTING.haloReach).toBeLessThan(NIGHT_LIGHTING.haloReach);
  });
});
