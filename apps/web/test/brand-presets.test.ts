import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRAND_PRESET_KEYS, DEFAULT_BRAND_PRESET } from "@capital-q/contracts";

import { oklchCssToHex } from "@/features/brand-theme/brand-colour";
import {
  BLACK_GOLD,
  BRAND_THEME_PRESETS,
  CLASSIC_BLUE,
  PRESET_TOKENS,
  brandPreset,
  checkContrast,
  contrastPairs,
  presetStyleSheet,
  type PresetMode,
  type PresetToken,
} from "@/features/brand-theme/brand-presets";
import { composeBrandStyle } from "@/features/brand-theme/brand-compose";

/**
 * K3 (ADR 0051): every preset, in both themes, passes WCAG AA for its
 * token pairs -- the same table design B's brand board checks -- so an
 * admin can switch the brand at any time without breaking a page.
 */

/** Classic blue is tokens.css itself: read its own values, light and dark. */
function classicModes(): { light: PresetMode; dark: PresetMode } {
  const css = readFileSync(
    fileURLToPath(
      new URL("../../../packages/ui/src/tokens/tokens.css", import.meta.url),
    ),
    "utf8",
  );
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media"));
  const darkStart = css.indexOf(':root[data-theme="dark"]');
  const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));
  const read = (block: string, fallback?: PresetMode): PresetMode => {
    const out: Partial<Record<PresetToken, string>> = {};
    for (const token of PRESET_TOKENS) {
      const match = new RegExp(`--cq-${token}:\\s*([^;]+);`, "u").exec(block);
      const raw = match?.[1]?.trim();
      const hex =
        raw === undefined
          ? (fallback?.[token] ?? null)
          : raw === "var(--cq-accent)"
            ? null
            : oklchCssToHex(raw);
      out[token] = hex ?? fallback?.[token] ?? "#000000";
    }
    return out as PresetMode;
  };
  const light = read(lightBlock);
  return { light, dark: read(darkBlock, light) };
}

describe("brand presets", () => {
  it("has a preset for every key the API accepts, black and gold by default", () => {
    for (const key of BRAND_PRESET_KEYS) {
      expect(BRAND_THEME_PRESETS[key].key).toBe(key);
    }
    expect(DEFAULT_BRAND_PRESET).toBe("black_gold");
    expect(brandPreset(null)).toBe(BLACK_GOLD);
    expect(brandPreset("neon")).toBe(BLACK_GOLD);
    expect(brandPreset("classic_blue")).toBe(CLASSIC_BLUE);
  });

  it.each(["light", "dark"] as const)(
    "black and gold passes AA for every token pair in %s",
    (theme) => {
      const palette = BLACK_GOLD.palette;
      if (palette === null) throw new Error("palette");
      const results = checkContrast(
        contrastPairs(palette[theme], palette.chrome, {
          canvas: palette.stage.canvas,
          qLight: palette.stage.qLight,
        }),
      );
      const failing = results.filter((r) => !r.passes);
      expect(failing.map((r) => `${r.name} ${r.ratio.toFixed(2)}`)).toEqual([]);
      expect(results.length).toBeGreaterThan(15);
    },
  );

  it("uses gold as text only where it reads: bronze on light, gold on dark", () => {
    const palette = BLACK_GOLD.palette;
    if (palette === null) throw new Error("palette");
    expect(palette.light.accent).toBe("#8a6a12");
    expect(palette.light["accent-hover"]).toBe("#6e5410");
    expect(palette.dark.accent).toBe("#c9a227");
    // Classic gold on white would fail: the reason for bronze.
    const [onWhite] = checkContrast([
      { name: "gold on white", fg: "#c9a227", bg: "#ffffff", need: 4.5 },
    ]);
    expect(onWhite?.passes).toBe(false);
  });

  it.each(["light", "dark"] as const)(
    "classic blue (tokens.css) passes AA for its text pairs in %s",
    (theme) => {
      const modes = classicModes();
      const mode = modes[theme];
      expect(modes.dark.canvas).not.toBe(modes.light.canvas);
      const pairs = contrastPairs(mode, null, null);
      // Really read from tokens.css, not defaulted.
      for (const pair of pairs) {
        expect([pair.fg, pair.bg]).not.toContain("#000000");
      }
      const results = checkContrast(pairs);
      const failing = results.filter((r) => !r.passes);
      expect(failing.map((r) => `${r.name} ${r.ratio.toFixed(2)}`)).toEqual([]);
    },
  );

  it("writes black and gold's whole look, and nothing for classic blue", () => {
    const css = presetStyleSheet(BLACK_GOLD);
    expect(css).toContain("--cq-canvas:#f6f4ef");
    expect(css).toContain("--cq-accent:#8a6a12");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(".cq-shell-sidebar,.cq-bottom-nav{");
    expect(css).toContain("--cq-stage-q-light:#e2b858");
    expect(css).not.toMatch(/<\/style|<script/iu);
    expect(presetStyleSheet(CLASSIC_BLUE)).toBe("");
  });

  it("writes nothing if any value is not a plain hex", () => {
    const palette = BLACK_GOLD.palette;
    if (palette === null) throw new Error("palette");
    expect(
      presetStyleSheet({
        ...BLACK_GOLD,
        palette: {
          ...palette,
          dark: { ...palette.dark, canvas: "#000;}</style><script>" },
        },
      }),
    ).toBe("");
  });

  it("puts an admin's own accent on top of the preset, and keeps Q's light the preset's", () => {
    const gold = composeBrandStyle({
      presetKey: "black_gold",
      primaryHex: null,
    });
    expect(gold).toContain("--cq-accent:#8a6a12");
    const teal = composeBrandStyle({
      presetKey: "black_gold",
      primaryHex: "#0f766e",
    });
    expect(teal).not.toBeNull();
    // The custom accent comes after the preset, so it wins by source order.
    expect((teal ?? "").lastIndexOf("--cq-accent:#0f766e")).toBeGreaterThan(
      (teal ?? "").indexOf("--cq-accent:#8a6a12"),
    );
    expect(teal).toContain("--cq-q-light:#8a6a12");
    expect(
      composeBrandStyle({ presetKey: "classic_blue", primaryHex: null }),
    ).toBeNull();
    expect(
      composeBrandStyle({ presetKey: "classic_blue", primaryHex: "#0f766e" }),
    ).toContain("--cq-accent:#0f766e");
    // A broken read keeps the default preset rather than a broken page.
    expect(composeBrandStyle(null)).toBe(presetStyleSheet(BLACK_GOLD));
  });
});
