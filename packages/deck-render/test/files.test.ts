import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { QDeck } from "@capital-q/contracts";

import {
  deckToPdf,
  deckToPptx,
  fetchSlideImages,
  inspectDeck,
  layOutDeck,
  slideToSvg,
} from "../src/index.js";

/**
 * Real files, not fake download buttons (QX-004 §7).
 *
 * The packet's requirement is a real editable PPTX and a real PDF, so the
 * assertions are about the artefacts: the container each format actually
 * is, the parts a PowerPoint has to contain, and — for the PDF — the file
 * read back in and asked what it holds, rather than a string search over
 * bytes that are mostly compressed anyway.
 *
 * Both are written from one layout, which is the property that makes a
 * viewer, a deck and a PDF agree: a founder who checks a slide in the
 * browser and sends the PowerPoint has sent what they checked.
 */

const deck: QDeck = {
  slides: [
    {
      layout: "TITLE",
      title: "Northstar Logistics",
      subtitle: "Freight between Lagos and Abuja",
      bullets: [],
      bulletsRight: [],
      section: 0,
    },
    {
      layout: "BULLETS",
      title: "Product",
      bullets: [
        "A mobile app for booking freight capacity.",
        "Live in Lagos, Abuja and Kano.",
      ],
      bulletsRight: [],
      note: "Mention the Kano pilot only if they ask.",
      section: 1,
    },
    {
      layout: "CHART",
      title: "Traction",
      bullets: [],
      bulletsRight: [],
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
      section: 2,
    },
  ],
  direction: "MINIMAL_INSTITUTIONAL",
  markIsDraft: false,
};

describe("QX-004 §7 · the files are real", () => {
  it("writes a PowerPoint whose slides are editable text, not a picture", async () => {
    const laid = layOutDeck(deck);
    expect(inspectDeck(laid)).toEqual([]);
    const bytes = await deckToPptx(laid, {
      title: "Northstar Logistics — investor deck",
      company: "Northstar Logistics",
    });
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    // A .pptx is a zip: "PK\x03\x04".
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const raw = Buffer.from(bytes).toString("latin1");
    // The parts an Office file must name, and one slide per slide.
    expect(raw).toContain("[Content_Types].xml");
    expect(raw).toContain("ppt/presentation.xml");
    expect(raw).toContain("ppt/slides/slide1.xml");
    expect(raw).toContain("ppt/slides/slide3.xml");
    expect(raw).not.toContain("ppt/slides/slide4.xml");
    // A speaker note travels as a note, where the founder can read it.
    expect(raw).toContain("notesSlide");
    // Every slide is a slide part with its own relationships, which is
    // what "editable" means here: a deck flattened to pictures would be
    // three image parts and no slide XML.
    expect(raw).toContain("ppt/slides/_rels/slide2.xml.rels");
    expect(raw).toContain("ppt/slideMasters/slideMaster1.xml");
  });

  it("writes a PDF at the slide's own size, one page per slide", async () => {
    const laid = layOutDeck(deck);
    const bytes = await deckToPdf(laid, {
      title: "Northstar Logistics — investor deck",
    });
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");

    // Read it back and ask it, rather than searching compressed bytes.
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(deck.slides.length);
    expect(reopened.getTitle()).toBe("Northstar Logistics — investor deck");
    for (const page of reopened.getPages()) {
      // The page box is the slide, so nothing is scaled or letterboxed.
      expect(page.getWidth()).toBeCloseTo(laid.width, 3);
      expect(page.getHeight()).toBeCloseTo(laid.height, 3);
    }
  });

  it("draws both from one layout, so neither invents a line of its own", async () => {
    const laid = layOutDeck(deck);
    // Every line either file can draw came from here.
    const lines = laid.slides.flatMap((slide) =>
      slide.boxes.flatMap((box) => (box.kind === "TEXT" ? box.lines : [])),
    );
    expect(lines).toContain("Northstar Logistics");
    // Set large, the sentence wraps: it is there, in the layout's lines.
    expect(lines.join(" ")).toContain(
      "A mobile app for booking freight capacity.",
    );
    const [pptx, pdf] = await Promise.all([
      deckToPptx(laid, { title: "t" }),
      deckToPdf(laid, { title: "t" }),
    ]);
    expect(Buffer.from(pptx).toString("latin1")).toContain(
      "ppt/slides/slide2.xml",
    );
    const reopened = await PDFDocument.load(pdf);
    expect(reopened.getPageCount()).toBe(laid.slides.length);
  });

  // Since BIZ-001 these characters are drawn, not stripped; `export.test.ts`
  // reads them back out of the file. This keeps the original guarantee:
  // an unusual character never fails the render.
  it("does not fail on a character the standard fonts cannot draw", async () => {
    const withEmDash = layOutDeck({
      ...deck,
      slides: [
        {
          layout: "STATEMENT",
          title: "What we do",
          bullets: ["We move freight — quickly — across Nigeria’s corridors."],
          bulletsRight: [],
          section: 0,
        },
      ],
    });
    const bytes = await deckToPdf(withEmDash, { title: "t" });
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
  });
});

describe("the cover the person asked for (ADR 0025)", () => {
  const covered: QDeck = {
    ...deck,
    cover: { background: ["#2e7d32", "#ffffff"], titleInk: "#000000" },
  };

  it("colours only the cover, in their ink, and says nothing is unreadable", () => {
    const laid = layOutDeck(covered);
    expect(laid.slides[0]?.background).toEqual(["#2e7d32", "#ffffff"]);
    expect(laid.slides[1]?.background).toBeUndefined();
    const title = laid.slides[0]?.boxes.find(
      (box) => box.kind === "TEXT" && box.role === "TITLE",
    );
    expect(title?.kind === "TEXT" && title.colour).toBe("#000000");
    // Without a chosen ink, the one that reads on every stop.
    const inkless = layOutDeck({
      ...deck,
      cover: { background: ["#0b3d1a"] },
    });
    const light = inkless.slides[0]?.boxes.find(
      (box) => box.kind === "TEXT" && box.role === "TITLE",
    );
    expect(light?.kind === "TEXT" && light.colour).toBe("#ffffff");
  });

  it("draws a gradient in the SVG and changes the PDF and PPTX it writes", async () => {
    const plain = layOutDeck(deck);
    const laid = layOutDeck(covered);
    const svg = slideToSvg(laid.slides[0] as never, laid);
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('stop-color="#2e7d32"');
    const [before, after] = await Promise.all([
      deckToPdf(plain, { title: "x" }),
      deckToPdf(laid, { title: "x" }),
    ]);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
    const pptx = await deckToPptx(laid, { title: "x" });
    expect(pptx.byteLength).toBeGreaterThan(0);
  });
});

describe("photographs on slides (founder direction 2026-09-29)", () => {
  const PNG = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const url = "https://images.pexels.com/photos/1/pexels-photo-1.jpeg";
  const photographed: QDeck = {
    ...deck,
    slides: deck.slides.map((slide, i) =>
      i === 1
        ? {
            ...slide,
            image: {
              url,
              alt: "A truck on a road",
              credit: "Photo by A on Pexels",
            },
          }
        : slide,
    ),
  };

  it("gives the photo the right of the slide and keeps the words to the left", () => {
    const laid = layOutDeck(photographed);
    const image = laid.slides[1]?.boxes.find((box) => box.kind === "IMAGE");
    expect(image).toMatchObject({ kind: "IMAGE", url, y: 0 });
    for (const box of laid.slides[1]?.boxes ?? []) {
      if (box.kind === "TEXT" && image?.kind === "IMAGE") {
        expect(box.x + box.width).toBeLessThanOrEqual(image.x);
      }
    }
  });

  it("fetches only from the stock library, and embeds what it fetched", async () => {
    const laid = layOutDeck(photographed);
    const asked: string[] = [];
    const images = await fetchSlideImages(laid, (input) => {
      asked.push(String(input));
      return Promise.resolve(new Response(PNG));
    });
    expect(asked).toEqual([url]);
    const pdf = await deckToPdf(laid, { title: "x" }, images);
    const plain = await deckToPdf(layOutDeck(deck), { title: "x" });
    expect(pdf.byteLength).toBeGreaterThan(plain.byteLength);
    const pptx = await deckToPptx(laid, { title: "x" }, images);
    expect(pptx.byteLength).toBeGreaterThan(0);
    const elsewhere = layOutDeck({
      ...deck,
      slides: [{ ...deck.slides[1]!, image: { url, alt: "a", credit: "c" } }],
    });
    const tampered = {
      ...elsewhere,
      slides: elsewhere.slides.map((slide) => ({
        ...slide,
        boxes: slide.boxes.map((box) =>
          box.kind === "IMAGE"
            ? { ...box, url: "https://evil.example/x.png" }
            : box,
        ),
      })),
    };
    const none: string[] = [];
    await fetchSlideImages(tampered, (input) => {
      none.push(String(input));
      return Promise.resolve(new Response(PNG));
    });
    expect(none).toEqual([]);
  });
});
