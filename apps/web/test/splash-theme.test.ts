import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Acceptance 2026-11-04 (visual after/, row 8): the splash is painted
 * before React sets its own data-theme, so a light-theme person saw the
 * dark #212121 backdrop. Its colours follow the choice the boot script
 * already put on <html>, or the device's when there is none.
 */
const GLOBALS = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

/** The declarations of the first rule whose selector list holds `selector`. */
function ruleFor(css: string, selector: string): string | null {
  const rule = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of css.matchAll(rule)) {
    const selectors = (match[1] ?? "")
      .split(",")
      .map((one) => one.replace(/\/\*[\s\S]*?\*\//gu, "").trim());
    if (selectors.includes(selector)) return match[2] ?? "";
  }
  return null;
}

describe("the splash follows the person's theme from the first paint", () => {
  it("a light choice on <html> paints it white", () => {
    expect(ruleFor(GLOBALS, ':root[data-theme="light"] .cq-splash')).toMatch(
      /--cq-splash-bg:\s*#ffffff;/u,
    );
  });

  it("no choice on a light device paints it white too", () => {
    const media = GLOBALS.split("@media (prefers-color-scheme: light)");
    const lightRules = media.slice(1).map((part) => part.slice(0, 2_000));
    expect(
      lightRules.some((part) =>
        /--cq-splash-bg:\s*#ffffff;/u.test(
          ruleFor(
            part,
            ':root:not([data-theme]) .cq-splash:not([data-theme="dark"])',
          ) ?? "",
        ),
      ),
    ).toBe(true);
  });

  it("dark stays the stage charcoal", () => {
    expect(ruleFor(GLOBALS, ".cq-splash")).toMatch(
      /--cq-splash-bg:\s*#212121;/u,
    );
  });
});
