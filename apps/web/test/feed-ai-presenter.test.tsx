// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DiscoveredCompanyDto } from "@capital-q/contracts";

import { aiPresenterLine, FeedCard } from "../src/features/discover/feed-card";
import { burnedTitleCropY } from "../src/features/discover/player/ai-presenter";

afterEach(cleanup);

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

  it("renders on the feed, whose card is drawn with showMedia={false} (live 2026-10-31: 0 of 24 cards)", () => {
    const card = (title: string | null): DiscoveredCompanyDto => ({
      companyId: "00000001-0000-4000-8000-000000000000",
      canonicalName: "Maji Loop",
      websiteUrl: null,
      headquartersCountry: "KE",
      currentStageCode: "seed",
      shortDescription: "Solar-pumped water kiosks.",
      reasons: [],
      reasonCodes: [],
      pitch: {
        mediaAssetId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        aspectRatio: "9:16",
        durationSeconds: 60,
        captionState: "AVAILABLE",
        title,
      },
    });
    const shown = (title: string | null) => {
      const { container } = render(
        <FeedCard
          company={card(title)}
          policy="ACTIVE"
          reducedMotion={false}
          saved={false}
          deciding={false}
          showMedia={false}
          onSave={() => undefined}
          onPass={() => undefined}
          onAskQ={() => undefined}
        />,
      );
      const label = container.querySelector("[data-ai-presenter]");
      cleanup();
      return label?.textContent ?? null;
    };
    expect(shown("Maji Loop: pitch summary (AI presenter, AI-generated)")).toBe(
      "AI presenter · AI-generated",
    );
    expect(shown("Seed pitch, March")).toBeNull();
  });

  it("at phone widths, an AI-presented pitch's words sit above the video's own lower third", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    // Measured on Maji Loop and Karoo Gridworks at 390: the burned-in
    // band runs from 78% to 90% of the stage's height.
    expect(css).toMatch(/--cq-feed-burned-band: 23%;/u);
    const at = css.indexOf(".cq-feed-overlay:has([data-ai-presenter]) {");
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at, css.indexOf("}", at))).toContain(
      "bottom: var(--cq-feed-burned-band)",
    );
    // A phone rule only: the desktop panel sits beside the pitch.
    const phone = css.lastIndexOf("@media (max-width: 1023px) {", at);
    expect(phone).toBeGreaterThan(0);
    expect(css.slice(phone, at)).not.toContain("\n  }\n");
  });
});

/**
 * Live 2026-11-15 (Discover at 1440, Watchly): the wide stage crops the
 * portrait pitch, which left its burned-in label row at the stage's foot,
 * a second, larger "AI presenter · AI-generated". Where the crop allows,
 * the picture shifts so the band falls outside the stage.
 */
describe("an AI-presented pitch on a stage wider than the pitch", () => {
  const shownBottom = (y: number, shown: number) =>
    (y / 100) * (1 - shown) + shown;

  it("shifts the picture so its burned-in band is cropped away", () => {
    // The desktop page pane at 1440: about 820 x 900, a 9:16 pitch.
    const y = burnedTitleCropY({
      boxWidth: 820,
      boxHeight: 900,
      frameWidth: 9,
      frameHeight: 16,
      titleTop: 77,
    });
    expect(y).not.toBeNull();
    const shown = 900 / ((820 * 16) / 9);
    expect(shownBottom(y ?? 50, shown)).toBeLessThanOrEqual(0.75);
    // Centred, the band was on screen.
    expect(shownBottom(50, shown)).toBeGreaterThan(0.77);
  });

  it("stays centred when the crop leaves room, and leaves a full-height pitch alone", () => {
    // A very wide stage: centred already hides the band.
    expect(
      burnedTitleCropY({
        boxWidth: 1600,
        boxHeight: 900,
        frameWidth: 9,
        frameHeight: 16,
        titleTop: 77,
      }),
    ).toBe(50);
    // A phone: the whole picture shows; the words lift above the band.
    expect(
      burnedTitleCropY({
        boxWidth: 390,
        boxHeight: 693,
        frameWidth: 9,
        frameHeight: 16,
        titleTop: 77,
      }),
    ).toBeNull();
    // No AI presenter, no band.
    expect(
      burnedTitleCropY({
        boxWidth: 820,
        boxHeight: 900,
        frameWidth: 9,
        frameHeight: 16,
        titleTop: null,
      }),
    ).toBeNull();
  });
});
