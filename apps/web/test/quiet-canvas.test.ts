import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(import.meta.dirname, "../app/globals.css"),
  "utf8",
);

/**
 * Client feedback UX-02 (2026-11-04): no repeated decorative pattern
 * behind the page or the Q conversation. The tiled grain, the shell's dot
 * grid and the Q page's star field are gone; Q's own mark and light stay.
 */
describe("the canvas behind text is quiet", () => {
  it("paints no tiled grain or dot grid behind the shell", () => {
    expect(css).not.toMatch(/fractalNoise/u);
    expect(css).not.toMatch(/var\(--cq-texture-dot\)/u);
    expect(css).not.toMatch(/body::after\s*\{/u);
  });

  it("draws no star field behind the Q page", () => {
    expect(css).not.toMatch(/\.cq-q-home::(before|after)/u);
    expect(css).not.toMatch(/var\(--cq-stage-star(-faint)?\)/u);
  });
});
