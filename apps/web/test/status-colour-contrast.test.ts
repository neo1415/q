import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ADR 0046: light-mode status colours reach WCAG AA (4.5:1) on every light
 * surface they sit on. Reads the real light values from tokens.css, the
 * one source of truth, and computes contrast.
 */
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const tokens = readFileSync(
  new URL("../../../packages/ui/src/tokens/tokens.css", import.meta.url),
  "utf8",
);
// The package's light :root block: up to its first closing brace.
const lightBlock = tokens.slice(
  tokens.indexOf(":root {"),
  tokens.indexOf("\n}", tokens.indexOf(":root {")),
);

type Oklch = [number, number, number];

function read(source: string, name: string): Oklch {
  const match = new RegExp(
    `--cq-${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`,
    "u",
  ).exec(source);
  if (match === null) throw new Error(`no --cq-${name}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([l, c, h]: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return (
    0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0)
  );
}

const ratio = (a: Oklch, b: Oklch) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe("light-mode status colours (ADR 0046)", () => {
  const surfaces = ["canvas", "surface", "surface-subtle", "surface-raised"];
  it.each(["warning", "positive"])(
    "%s reaches 4.5:1 on light surfaces",
    (name) => {
      const colour = read(lightBlock, name);
      for (const surface of [...surfaces, `${name}-soft`]) {
        expect(ratio(colour, read(lightBlock, surface))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

  it("has one source of truth: globals.css does not redefine them", () => {
    expect(globals).not.toMatch(/--cq-(warning|positive):/u);
  });
});
