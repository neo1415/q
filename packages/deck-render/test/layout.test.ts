import { describe, expect, it } from "vitest";

import type { QDeck, QSlide } from "@capital-q/contracts";

import {
  contrastRatio,
  deckToSvg,
  inspectDeck,
  layOutDeck,
  measure,
  wrap,
  MARGIN,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from "../src/index.js";

/**
 * Laying a deck out, and knowing when it is broken (QX-004 §5, §6, §7).
 *
 * The packet says not to generate a file and assume it looks good, and
 * not to answer "it does not fit" by shrinking everything to eight point.
 * Both are properties of the layout rather than of a picture, which is
 * what these drive:
 *
 * **A clean deck reports nothing.** No overlap, nothing past the gutter,
 * no type under the floor, no unlabelled column.
 *
 * **A slide with too much on it is caught, not quietly cropped.** The
 * layout steps type down once, has a floor, and what still does not fit
 * is reported as dropped rather than drawn off the edge.
 *
 * **Every renderer reads the same geometry.** The SVG carries the lines
 * the layout wrapped, not lines of its own.
 */

function slide(overrides: Partial<QSlide> = {}): QSlide {
  return {
    layout: "BULLETS",
    title: "Traction",
    bullets: ["Completed 320 deliveries in June.", "Two pilots signed."],
    bulletsRight: [],
    section: 1,
    ...overrides,
  };
}

function deck(overrides: Partial<QDeck> = {}): QDeck {
  return {
    slides: [
      {
        layout: "TITLE",
        title: "Northstar Logistics",
        subtitle: "Freight between Lagos and Abuja",
        bullets: [],
        bulletsRight: [],
        section: 0,
      },
      slide(),
    ],
    direction: "MINIMAL_INSTITUTIONAL",
    markIsDraft: false,
    ...overrides,
  };
}

describe("QX-004 §5 · a deck knows when it is broken", () => {
  it("reports nothing about a deck that is fine", () => {
    expect(inspectDeck(layOutDeck(deck()))).toEqual([]);
  });

  it("keeps everything inside the gutter", () => {
    const laid = layOutDeck(deck());
    for (const page of laid.slides) {
      for (const box of page.boxes) {
        // The cover's colour field runs to the edge on purpose, and the
        // page number sits in the bottom gutter by design.
        if (box.kind === "RULE" && box.bleed === true) continue;
        if (box.kind === "TEXT" && box.role === "FOOTER") {
          expect(box.y + box.height).toBeLessThanOrEqual(SLIDE_HEIGHT - 16);
          continue;
        }
        expect(box.x).toBeGreaterThanOrEqual(MARGIN - 1);
        expect(box.y).toBeGreaterThanOrEqual(MARGIN - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(SLIDE_WIDTH - MARGIN + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(
          SLIDE_HEIGHT - MARGIN + 1,
        );
      }
    }
  });

  it("places everything a slide is allowed to carry, without going under the floor", () => {
    // The contract caps a slide at six bullets of 180 characters. A slide
    // filled to that cap must still fit, or the composer and the layout
    // disagree about what a slide holds — and the founder finds out by
    // opening the file.
    const full = deck({
      slides: [
        slide({
          bullets: Array.from({ length: 6 }, (_, index) =>
            `${String(index)}. ${"A long sentence about the business that keeps going and going and going. ".repeat(3)}`.slice(
              0,
              180,
            ),
          ),
        }),
      ],
    });
    const laid = layOutDeck(full);
    expect(laid.slides[0]?.dropped).toEqual([]);
    const sizes = (laid.slides[0]?.boxes ?? [])
      // Captions (a page number, a source) have their own, lower floor.
      .filter(
        (box) =>
          box.kind === "TEXT" &&
          box.role !== "FOOTER" &&
          box.role !== "CAPTION",
      )
      .map((box) => (box.kind === "TEXT" ? box.size : 0));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(laid.theme.minimumSize);
  });

  it("reports what it could not place rather than drawing it off the slide", () => {
    const crowded = deck({
      slides: [
        slide({
          subtitle:
            "A long framing line the founder wrote, which takes up several lines of its own before a single bullet has been placed on the slide at all.".slice(
              0,
              240,
            ),
          bullets: Array.from({ length: 6 }, (_, index) =>
            `${String(index)}. ${"Another full line of detail that a founder wrote out in their own words. ".repeat(3)}`.slice(
              0,
              180,
            ),
          ),
        }),
      ],
    });
    const laid = layOutDeck(crowded);
    const issues = inspectDeck(laid);
    // Deck quality: a crowded slide now closes up into two columns of
    // rows; whether it then drops a line or carries too many, it is caught.
    const faults = issues.map((i) => i.fault);
    expect(
      faults.includes("CONTENT_DROPPED") || faults.includes("TOO_DENSE"),
    ).toBe(true);
    // It says what to change, in the founder's own terms.
    const dropped = issues.find((i) => i.fault === "CONTENT_DROPPED");
    if (dropped !== undefined) expect(dropped.detail).toMatch(/did not fit/);
    else
      expect(issues.find((i) => i.fault === "TOO_DENSE")?.detail).toMatch(
        /say less/,
      );
    // And it did not answer the crowding by shrinking the type to nothing:
    // saying less is the answer, and that is the composer's to make.
    const sizes = (laid.slides[0]?.boxes ?? [])
      .filter(
        (box) =>
          box.kind === "TEXT" &&
          box.role !== "FOOTER" &&
          box.role !== "CAPTION",
      )
      .map((box) => (box.kind === "TEXT" ? box.size : 0));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(laid.theme.minimumSize);
  });

  it("holds every direction to a readable contrast", () => {
    for (const direction of [
      "MINIMAL_INSTITUTIONAL",
      "DARK_TECHNICAL",
      "WARM_GROWTH",
    ]) {
      const laid = layOutDeck(deck({ direction }));
      expect(
        contrastRatio(laid.theme.ink, laid.theme.background) ?? 0,
      ).toBeGreaterThan(4.5);
      expect(inspectDeck(laid)).toEqual([]);
    }
  });

  it("falls back to the institutional direction rather than failing on one it has not heard of", () => {
    const laid = layOutDeck(deck({ direction: "SOMETHING_NEW" }));
    expect(laid.theme.background).toBe("#ffffff");
    expect(inspectDeck(laid)).toEqual([]);
  });
});

describe("QX-004 §6 · charts are drawn from the numbers and nothing else", () => {
  const charted = deck({
    slides: [
      slide({
        layout: "CHART",
        title: "Traction",
        chart: {
          kind: "COLUMN",
          measure: "Deliveries",
          unit: "count",
          points: [
            { label: "June", value: "320" },
            { label: "July", value: "480" },
          ],
          grounding: "From what the founder told Capital Q.",
        },
      }),
    ],
  });

  it("scales the columns to each other and labels every one", () => {
    const laid = layOutDeck(charted);
    const chart = laid.slides[0]?.boxes.find((box) => box.kind === "CHART");
    expect(chart?.kind).toBe("CHART");
    if (chart?.kind !== "CHART") throw new Error("no chart");
    const [june, july] = chart.bars;
    expect(june?.formatted).toBe("320");
    expect(july?.formatted).toBe("480");
    // 320 is two-thirds of 480, and the columns say so.
    expect((june?.height ?? 0) / (july?.height ?? 1)).toBeCloseTo(320 / 480, 1);
    expect(june?.label.length).toBeGreaterThan(0);
    expect(inspectDeck(laid)).toEqual([]);
  });

  it("puts the unit beside a value that has one", () => {
    const laid = layOutDeck(
      deck({
        slides: [
          slide({
            layout: "CHART",
            title: "Margin",
            chart: {
              kind: "COLUMN",
              measure: "Gross margin",
              unit: "%",
              points: [
                { label: "2025", value: "28" },
                { label: "2026", value: "35" },
              ],
              grounding: "Stated by the company.",
            },
          }),
        ],
      }),
    );
    const chart = laid.slides[0]?.boxes.find((box) => box.kind === "CHART");
    if (chart?.kind !== "CHART") throw new Error("no chart");
    expect(chart.bars[0]?.formatted).toBe("28 %");
  });
});

describe("QX-004 §7 · every renderer reads the same geometry", () => {
  it("draws the lines the layout wrapped, and escapes what a founder wrote", () => {
    const laid = layOutDeck(
      deck({
        slides: [
          slide({
            title: "Product",
            bullets: ['We build <b>freight</b> software & "logistics" tools.'],
          }),
        ],
      }),
    );
    const [svg] = deckToSvg(laid);
    expect(svg).toContain("&lt;b&gt;freight&lt;/b&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("<b>");
    // The viewBox is the slide, so a browser and a page agree on the size.
    expect(svg).toContain(
      `viewBox="0 0 ${String(SLIDE_WIDTH)} ${String(SLIDE_HEIGHT)}"`,
    );
  });

  it("measures wider strings as wider, and wraps to the width it is given", () => {
    expect(measure("MMMMM", 20)).toBeGreaterThan(measure("iiiii", 20));
    expect(measure("AAAAA", 20)).toBeGreaterThan(measure("aaaaa", 20));
    const lines = wrap("one two three four five six seven eight", 20, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measure(line, 20)).toBeLessThanOrEqual(120 + 20 * 0.92);
    }
  });
});

describe("a small chart under headline figures (deck wave 8)", () => {
  it("draws the figures, then the chart, then the lines, with nothing dropped", () => {
    const laid = layOutDeck(
      deck({
        slides: [
          deck().slides[0] as QSlide,
          slide({
            title: "1,140 paying businesses",
            bullets: ["Sold through accountant partners"],
            figures: [
              { value: "1,140", label: "Paying businesses" },
              { value: "₦38m", label: "MRR" },
            ],
            chart: {
              kind: "COLUMN",
              measure: "Paying businesses",
              unit: "count",
              points: [
                { label: "Start", value: "590" },
                { label: "After twelve months", value: "1140" },
              ],
              grounding: "Read from the slide: grew from 590 to 1,140",
              source: "the company's record on Capital Q",
            },
          }),
        ],
      }),
    );
    const numbers = laid.slides[1];
    expect(numbers?.dropped).toEqual([]);
    const kinds = new Set(numbers?.boxes.map((box) => box.kind));
    expect(kinds.has("CHART")).toBe(true);
    expect(inspectDeck(laid)).toEqual([]);
    expect(deckToSvg(laid)[1]).toContain("1,140");
  });
});
