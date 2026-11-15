import { describe, expect, it } from "vitest";

import { chromaOf, rankCssBrandColours } from "../src/website-colour.js";

/**
 * GateQ brand from website: CSS colours ranked by where they are used and
 * how vivid they are (live re-check 2026-11-15: Stripe read as #b9b9f9).
 */
describe("ranking a site's CSS colours", () => {
  it("a vivid brand colour beats a pale tint that is named first and used more", () => {
    const ranked = rankCssBrandColours({
      css: [
        ":root{--accent-light:#b9b9f9;--brand:#635bff}",
        ".a{color:#b9b9f9}.b{color:#b9b9f9}.c{color:#b9b9f9}",
        ".btn{background:#635bff}",
      ],
    });
    expect(ranked[0]).toBe("#635bff");
    expect(ranked).toContain("#b9b9f9");
  });

  it("a button or link background outweighs an incidental use", () => {
    expect(
      rankCssBrandColours({
        css: [".x{color:#b45309}.cta{background-color:#0f766e}"],
      })[0],
    ).toBe("#0f766e");
  });

  it("greys, near-white and near-black are never brand colours", () => {
    expect(
      rankCssBrandColours({
        css: [":root{--brand:#111111;--primary:#fafafa}.x{color:#777777}"],
      }),
    ).toEqual([]);
  });

  it("inline style attributes count too", () => {
    expect(
      rankCssBrandColours({
        css: [".a{color:#1d4ed8}"],
        inline: ["color:#b91c1c"],
      }),
    ).toEqual(["#1d4ed8", "#b91c1c"]);
  });

  it("chroma: zero for greys, high for a full hue", () => {
    expect(chromaOf("#808080")).toBe(0);
    expect(chromaOf("#635bff")).toBeGreaterThan(chromaOf("#b9b9f9"));
  });
});
