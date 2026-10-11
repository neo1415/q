import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@capital-q/ui/tokens";

import {
  isThemeChoice,
  themeColorFor,
  THEME_BOOT_SCRIPT,
  THEME_CHOICES,
} from "../src/features/appearance/theme";
import { composeBrandStyle } from "../src/features/brand-theme/brand-compose";

const read = (path: string) =>
  readFileSync(resolve(__dirname, "..", path), "utf8");

describe("theme selection", () => {
  it("accepts exactly system, light and dark", () => {
    expect([...THEME_CHOICES]).toEqual(["system", "light", "dark"]);
    expect(isThemeChoice("dark")).toBe(true);
    expect(isThemeChoice("sepia")).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });

  it("gives the browser bar a colour for a manual choice, none for system", () => {
    expect(themeColorFor("light")).toBe(THEME_COLORS.light.canvas);
    expect(themeColorFor("dark")).toBe(THEME_COLORS.dark.canvas);
    expect(themeColorFor("system")).toBeNull();
  });

  it("boots the stored choice before paint from the same key the app uses", () => {
    expect(THEME_BOOT_SCRIPT).toContain("cq.theme");
    expect(THEME_BOOT_SCRIPT).toContain("data-theme");
  });
});

describe("public pages follow the app's theme contract", () => {
  const css = composeBrandStyle(null) ?? "";

  it("carries Capital Q gold in light, dark and device-dark", () => {
    expect(css).toContain(":root{");
    expect(css).toContain(
      '@media (prefers-color-scheme: dark){:root:not([data-theme="light"])',
    );
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("--cq-accent:#8a6a12"); // bronze on light
    expect(css).toContain("--cq-accent:#c9a227"); // gold on dark
  });

  it("no longer pins the landing page to a light blue palette", () => {
    const landing = read("src/features/landing/landing.css");
    expect(landing).not.toMatch(/color-scheme:\s*light/);
    expect(landing).not.toMatch(/--cq-canvas:\s*oklch/);
    expect(landing).not.toMatch(/--cq-accent:\s*oklch/);
    expect(landing).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("offers the theme switch signed out on the landing page", () => {
    const page = read("src/features/landing/landing-page.tsx");
    expect(page).toContain("<ThemeToggle");
    expect(page).toContain("<PublicBrandStyle");
  });

  it("defines the gold metal tokens for light and both dark forms", () => {
    const tokens = readFileSync(
      resolve(__dirname, "../../../packages/ui/src/tokens/tokens.css"),
      "utf8",
    );
    expect(tokens.match(/--cq-gold-mid:/g)).toHaveLength(3);
    expect(tokens.match(/--cq-gold-ink:/g)).toHaveLength(3);
  });
});
