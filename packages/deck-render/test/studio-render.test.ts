import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { QDeckSchema, type QChart, type QDeck } from "@capital-q/contracts";

import {
  deckToPdf,
  deckToPptx,
  designDirectionFor,
  inspectDeck,
  layOutDeck,
  slideToSvg,
  themeFor,
  type LaidOutBox,
  type TextBox,
} from "../src/index.js";

/**
 * DOCS: chart forms, source lines, type pairings and the brand logo,
 * asserted on the layout (the one geometry every renderer reads) and on
 * the files written from it.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function chartDeck(chart: QChart, extra: Partial<QDeck> = {}): QDeck {
  return QDeckSchema.parse({
    slides: [
      { layout: "TITLE", title: "Northstar Logistics", section: 0 },
      { layout: "CHART", title: "Traction", chart, section: 1 },
    ],
    ...extra,
  });
}

const POINTS = [
  { label: "June", value: "320" },
  { label: "July", value: "410" },
  { label: "August", value: "0" },
  { label: "September", value: "655" },
];

function chart(kind: QChart["kind"], points = POINTS): QChart {
  return {
    kind,
    measure: "Deliveries",
    unit: "count",
    points,
    grounding: "Stated by the founder: deliveries per month.",
    source: "company record, stated by the founder",
  };
}

const texts = (boxes: readonly LaidOutBox[]): string[] =>
  boxes
    .filter((box): box is TextBox => box.kind === "TEXT")
    .flatMap((box) => box.lines);

describe("chart forms (DOCS)", () => {
  for (const kind of ["COLUMN", "BAR", "LINE", "DONUT"] as const) {
    it(`${kind}: lays out without faults and prints its source`, () => {
      const points =
        kind === "DONUT"
          ? [
              { label: "Lagos", value: "60" },
              { label: "Abuja", value: "30" },
              { label: "Kano", value: "10" },
            ]
          : POINTS;
      const laid = layOutDeck(chartDeck(chart(kind, points)));
      expect(inspectDeck(laid)).toEqual([]);
      const words = texts(laid.slides[1]?.boxes ?? []);
      expect(words).toContain("Source: company record, stated by the founder");
    });
  }

  it("BAR: lengths from a zero baseline, every value printed beside its bar", () => {
    const laid = layOutDeck(chartDeck(chart("BAR")));
    const boxes = laid.slides[1]?.boxes ?? [];
    const bars = boxes.filter(
      (box) => box.kind === "RULE" && box.height > 4 && box.width > 1,
    );
    expect(bars).toHaveLength(4);
    const widths = bars.map((bar) => bar.width);
    // 655 is the longest; 0 is drawn as a sliver, never as a negative.
    expect(Math.max(...widths)).toBe(widths[3]);
    expect(widths[2]).toBe(2);
    expect(Math.round(((widths[0] ?? 0) / (widths[3] ?? 1)) * 655)).toBeCloseTo(
      320,
      -1,
    );
    expect(texts(boxes)).toEqual(
      expect.arrayContaining(["320", "410", "0", "655"]),
    );
  });

  it("LINE: one path through every point, each point labelled", () => {
    const laid = layOutDeck(chartDeck(chart("LINE")));
    const slide = laid.slides[1];
    if (slide === undefined) throw new Error("no chart slide");
    const paths = slide.boxes.filter((box) => box.kind === "PATH");
    expect(paths).toHaveLength(1);
    const path = paths[0];
    expect(path?.kind === "PATH" ? path.points : []).toHaveLength(4);
    expect(slideToSvg(slide, laid)).toContain("<polyline");
  });

  it("DONUT: parts of a whole as one stacked bar with value and share", () => {
    const laid = layOutDeck(
      chartDeck(
        chart("DONUT", [
          { label: "Lagos", value: "60" },
          { label: "Abuja", value: "40" },
        ]),
      ),
    );
    const words = texts(laid.slides[1]?.boxes ?? []);
    expect(words).toContain("Lagos: 60 (60%)");
    expect(words).toContain("Abuja: 40 (40%)");
  });

  it("DONUT: parts that are not a whole are drawn as bars instead", () => {
    const laid = layOutDeck(chartDeck(chart("DONUT", POINTS)));
    const words = texts(laid.slides[1]?.boxes ?? []);
    expect(words.some((word) => word.includes("%"))).toBe(false);
    expect(words).toContain("655");
  });

  it("writes every chart form into a PDF and a PPTX", async () => {
    for (const kind of ["COLUMN", "BAR", "LINE", "DONUT"] as const) {
      const laid = layOutDeck(chartDeck(chart(kind)));
      const pdf = await PDFDocument.load(
        await deckToPdf(laid, { title: "Deck" }),
      );
      expect(pdf.getPageCount()).toBe(2);
      const pptx = Buffer.from(await deckToPptx(laid, { title: "Deck" }));
      expect(pptx.subarray(0, 2).toString("latin1")).toBe("PK");
      expect(pptx.toString("latin1")).toContain("ppt/slides/slide2.xml");
    }
  });
});

describe("brand (DOCS)", () => {
  it("draws the logo on the cover, fitted, and embeds it in both files", async () => {
    const deck = chartDeck(chart("COLUMN"));
    const laid = layOutDeck(deck, {
      logo: { bytes: new Uint8Array(PNG_1X1), contentType: "image/png" },
    });
    const logo = laid.slides[0]?.boxes.find((box) => box.kind === "IMAGE");
    expect(logo?.kind === "IMAGE" ? logo.fit : null).toBe("contain");
    expect(logo?.kind === "IMAGE" ? logo.url : "").toMatch(
      /^data:image\/png;base64,/,
    );
    expect(inspectDeck(laid)).toEqual([]);
    // Only the cover carries it.
    expect(laid.slides[1]?.boxes.some((box) => box.kind === "IMAGE")).toBe(
      false,
    );

    const plain = await deckToPdf(layOutDeck(deck), { title: "Deck" });
    const branded = await deckToPdf(laid, { title: "Deck" });
    expect(Buffer.from(branded).toString("latin1")).toContain("/Image");
    expect(Buffer.from(plain).toString("latin1")).not.toContain(
      "/Subtype /Image",
    );
    const pptx = Buffer.from(await deckToPptx(laid, { title: "Deck" }));
    expect(pptx.toString("latin1")).toContain("ppt/media/");
  });

  it("names the pairing's faces; an unknown pairing keeps the direction's", () => {
    expect(
      themeFor("MINIMAL_INSTITUTIONAL", undefined, "INTER_ONLY"),
    ).toMatchObject({ headingFont: "Inter", bodyFont: "Inter" });
    expect(
      themeFor("MINIMAL_INSTITUTIONAL", undefined, "NOT_A_PAIRING"),
    ).toMatchObject({ headingFont: "Georgia", bodyFont: "Helvetica" });
    const laid = layOutDeck(
      chartDeck(chart("COLUMN"), {
        brand: { pairing: "PLEX_SANS_PLEX_SERIF" },
      }),
    );
    expect(laid.theme.headingFont).toBe("IBM Plex Serif");
    const svg = slideToSvg(
      laid.slides[0] ?? {
        index: 0,
        layout: "TITLE",
        title: "",
        boxes: [],
        note: undefined,
        dropped: [],
      },
      laid,
    );
    expect(svg).toContain("IBM Plex Serif, Helvetica");
  });

  it("starts a sector's deck from its direction, by taxonomy code", () => {
    expect(designDirectionFor(["fintech"]).direction).toBe(
      "MINIMAL_INSTITUTIONAL",
    );
    expect(designDirectionFor(["unknown", "cybersecurity"]).direction).toBe(
      "DARK_TECHNICAL",
    );
    expect(designDirectionFor(["agritech"]).pairing).toBe(
      "SOURCE_SANS_FRAUNCES",
    );
    expect(designDirectionFor([]).direction).toBe("MINIMAL_INSTITUTIONAL");
  });
});
