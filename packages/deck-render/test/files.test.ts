import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { QDeck } from "@capital-q/contracts";

import {
  deckToPdf,
  deckToPptx,
  inspectDeck,
  layOutDeck,
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
} as QDeck;

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
    expect(lines).toContain("A mobile app for booking freight capacity.");
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
    } as QDeck);
    const bytes = await deckToPdf(withEmDash, { title: "t" });
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
  });
});
