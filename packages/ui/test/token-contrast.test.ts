import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA text contrast (1.4.3, 4.5:1) is a property of the tokens, so
 * it is checked on the tokens (R30 #11: accent buttons at 4.30:1, accent
 * links at 4.37:1 and tertiary text at 4.26:1 in the light theme).
 */

const CSS = readFileSync(
  fileURLToPath(new URL("../src/tokens/tokens.css", import.meta.url)),
  "utf8",
);

type Theme = Readonly<Record<string, readonly [number, number, number]>>;

/** The oklch tokens declared in the first block matching `selector`. */
function theme(selector: string): Theme {
  const start = CSS.indexOf(selector);
  const block = CSS.slice(start, CSS.indexOf("}", start));
  const tokens: Record<string, readonly [number, number, number]> = {};
  for (const match of block.matchAll(
    /(--cq-[a-z-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g,
  )) {
    const [, name, l, c, h] = match;
    if (name === undefined) continue;
    tokens[name] = [Number(l), Number(c), Number(h)];
  }
  return tokens;
}

/** oklch to linear sRGB (Björn Ottosson's matrices), clamped to gamut. */
function linear([l, c, h]: readonly [number, number, number]): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

function contrast(
  x: readonly [number, number, number],
  y: readonly [number, number, number],
): number {
  const lum = (v: readonly [number, number, number]) => {
    const [r = 0, g = 0, b = 0] = linear(v);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const PAIRS: readonly (readonly [string, string])[] = [
  ["--cq-text-primary", "--cq-canvas"],
  ["--cq-text-secondary", "--cq-canvas"],
  ["--cq-text-tertiary", "--cq-canvas"],
  ["--cq-text-tertiary", "--cq-surface"],
  ["--cq-text-tertiary", "--cq-surface-subtle"],
  ["--cq-text-tertiary", "--cq-surface-sunken"],
  ["--cq-accent", "--cq-canvas"],
  ["--cq-accent", "--cq-surface"],
  ["--cq-accent", "--cq-surface-subtle"],
  // Button text on the accent fill.
  ["--cq-text-inverse", "--cq-accent"],
  ["--cq-text-inverse", "--cq-accent-hover"],
];

describe.each([
  ["light", theme(":root {")],
  ["dark", theme(':root[data-theme="dark"] {')],
])("%s theme text contrast", (_name, tokens) => {
  it.each(PAIRS)("%s on %s is at least 4.5:1", (text, ground) => {
    const fg = tokens[text];
    const bg = tokens[ground];
    expect(fg, text).toBeDefined();
    expect(bg, ground).toBeDefined();
    if (fg === undefined || bg === undefined) return;
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
