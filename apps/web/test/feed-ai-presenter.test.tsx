import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { aiPresenterLine } from "../src/features/discover/feed-card";

/**
 * Live 2026-10-31 (Discover at 390 and 360): an AI-presented pitch's
 * label is burned into the video's lower third, at the height of the
 * caption, and ran through the company's name. The app says the label in
 * the caption's flow, and the caption's scrim is deep behind every line.
 */
describe("an AI-presented pitch on Discover", () => {
  it("is labelled by the app from the video's recorded provenance", () => {
    expect(
      aiPresenterLine(
        "Karoo Gridworks: pitch summary (AI presenter, AI-generated)",
      ),
    ).toBe("AI presenter · AI-generated");
    expect(aiPresenterLine("Seed pitch, March")).toBeNull();
    expect(aiPresenterLine(null)).toBeNull();
  });

  it("puts every caption line on the deep scrim, fading only above the first", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    for (const selector of ["\n  .cq-feed-overlay {", "\n  .cq-yours-info {"]) {
      const at = css.indexOf(selector);
      const rule = css.slice(at, css.indexOf("}", at));
      expect(rule, selector).toMatch(
        /var\(--cq-feed-scrim-deep\) 0%,[\s\S]*var\(--cq-feed-scrim-deep\) calc\(100% - 40px\)/u,
      );
      expect(rule, selector).not.toContain("scrim-floor");
    }
  });
});
