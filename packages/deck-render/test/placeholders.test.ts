import { describe, expect, it } from "vitest";

import type { QDeck, QSlide } from "@capital-q/contracts";

import {
  deckToPptx,
  deckToSvg,
  inspectDeck,
  layOutDeck,
  slidePlaceholderBoxes,
  SLIDE_WIDTH,
} from "../src/index.js";

/**
 * Q room W5 (R8): a placeholder is drawn as a marked space (never as
 * content), keeps the picture's side free, passes the same inspection as
 * any slide, and tells the room where its drop target goes.
 */

function slide(overrides: Partial<QSlide> = {}): QSlide {
  return {
    layout: "BULLETS",
    title: "Team",
    bullets: ["Ada Obi, CEO: ten years in freight."],
    bulletsRight: [],
    section: 1,
    ...overrides,
  };
}

function deck(slides: QSlide[]): QDeck {
  return { slides, direction: "MINIMAL_INSTITUTIONAL", markIsDraft: false };
}

describe("placeholders on a slide", () => {
  it("an IMAGE placeholder takes the picture's side, marked, with its label", () => {
    const laid = layOutDeck(
      deck([
        slide({
          placeholder: { kind: "IMAGE", label: "Team photo: add yours" },
        }),
      ]),
    );
    const boxes = slidePlaceholderBoxes(laid);
    expect(boxes).toEqual([
      expect.objectContaining({
        slide: 0,
        kind: "IMAGE",
        x: Math.round(SLIDE_WIDTH * 0.6),
      }),
    ]);
    const svg = deckToSvg(laid)[0] ?? "";
    expect(svg).toContain("Team photo: add yours");
    // The words keep the left: nothing of the slide's text crosses into it.
    for (const box of laid.slides[0]?.boxes ?? []) {
      if (box.kind === "TEXT" && box.role !== "LABEL") {
        expect(box.x + box.width).toBeLessThanOrEqual(
          Math.round(SLIDE_WIDTH * 0.6),
        );
      }
    }
    expect(inspectDeck(laid)).toEqual([]);
  });

  it("a real picture wins over a placeholder", () => {
    const laid = layOutDeck(
      deck([
        slide({
          placeholder: { kind: "IMAGE", label: "Team photo: add yours" },
          image: {
            url: "https://images.pexels.com/photos/1/a.jpeg",
            alt: "Team",
            credit: "Photo by Ada on Pexels",
          },
        }),
      ]),
    );
    expect(slidePlaceholderBoxes(laid)).toEqual([]);
  });

  it("a TEXT placeholder is a band under the words, only where there is room", () => {
    const laid = layOutDeck(
      deck([
        slide({
          layout: "STATEMENT",
          title: "Traction",
          bullets: [],
          placeholder: { kind: "TEXT", label: "Revenue: add yours" },
        }),
      ]),
    );
    expect(slidePlaceholderBoxes(laid)).toEqual([
      expect.objectContaining({ kind: "TEXT" }),
    ]);
    expect(inspectDeck(laid)).toEqual([]);
  });

  it("draws into the editable PowerPoint too", async () => {
    const laid = layOutDeck(
      deck([
        slide({
          placeholder: {
            kind: "IMAGE",
            label: "Product screenshot: add yours",
          },
        }),
      ]),
    );
    const bytes = await deckToPptx(laid, { title: "Draft" });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
