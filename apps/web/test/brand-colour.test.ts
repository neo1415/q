import { describe, expect, it } from "vitest";

import {
  AA,
  DEFAULT_BRAND_HEX,
  brandPalette,
  brandStyleSheet,
  contrastRatio,
  normaliseHex,
} from "@/features/brand-theme/brand-colour";

const SAMPLES = [
  "#0f766e", // teal
  "#ffd400", // bright yellow: far too light for paper
  "#000000",
  "#ffffff",
  "#7c3aed",
  "#e11d48",
  "#00ff00",
  "#1e3a8a", // navy: far too dark for the dark canvas
  "#808080",
  DEFAULT_BRAND_HEX,
];

describe("brand colour", () => {
  it("normalises hex and refuses anything else", () => {
    expect(normaliseHex("#0F766E")).toBe("#0f766e");
    expect(normaliseHex("abc")).toBe("#aabbcc");
    expect(normaliseHex(" #123456 ")).toBe("#123456");
    expect(normaliseHex("red")).toBeNull();
    expect(normaliseHex("#12345")).toBeNull();
    expect(normaliseHex("#1234567")).toBeNull();
    expect(normaliseHex("url(x)")).toBeNull();
    expect(brandPalette("not a colour")).toBeNull();
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it.each(SAMPLES)(
    "%s keeps button text and accent text at AA in both themes",
    (hex) => {
      const palette = brandPalette(hex);
      expect(palette).not.toBeNull();
      if (palette === null) return;
      for (const theme of [palette.light, palette.dark]) {
        expect(theme.fillContrast).toBeGreaterThanOrEqual(AA);
        expect(theme.textContrast).toBeGreaterThanOrEqual(AA);
        expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/u);
        expect(theme.hover).toMatch(/^#[0-9a-f]{6}$/u);
        expect(theme.soft).toMatch(/^#[0-9a-f]{6}$/u);
      }
    },
  );

  it("uses the brand colour unchanged when it already reads well", () => {
    const palette = brandPalette("#0f766e");
    expect(palette?.light.accent).toBe("#0f766e");
    expect(palette?.light.adjusted).toBe(false);
    // Too dark for the dark canvas: lifted, same family.
    expect(palette?.dark.adjusted).toBe(true);
  });

  it("darkens a light brand on paper and lightens a dark one at night", () => {
    const yellow = brandPalette("#ffd400");
    expect(yellow?.light.adjusted).toBe(true);
    expect(yellow?.dark.adjusted).toBe(false);
    const navy = brandPalette("#1e3a8a");
    expect(navy?.light.adjusted).toBe(false);
    expect(navy?.dark.adjusted).toBe(true);
  });

  it("writes only accent tokens, never Q's light", () => {
    const palette = brandPalette("#7c3aed");
    if (palette === null) throw new Error("palette");
    const css = brandStyleSheet(palette);
    expect(css).toContain("--cq-accent:");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).not.toContain("--cq-q-");
    expect(css).not.toMatch(/[<>{]\s*\/|<\/style/iu);
  });

  it("writes nothing if a value is not a plain hex", () => {
    const palette = brandPalette("#7c3aed");
    if (palette === null) throw new Error("palette");
    expect(
      brandStyleSheet({
        ...palette,
        light: { ...palette.light, accent: "red;}</style><script>" },
      }),
    ).toBe("");
  });
});
