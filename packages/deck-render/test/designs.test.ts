import { inflateRawSync } from "node:zlib";

import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { QDeckSchema, type QDeck } from "@capital-q/contracts";

import {
  contrastRatio,
  deckToPdf,
  deckToPptx,
  inspectDeck,
  layOutDeck,
  measure,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type LaidOutDeck,
  type TextBox,
} from "../src/index.js";

/**
 * Deck quality (2026-10-08): the design system.
 *
 * The founder opened a Q deck and found it "simple and juvenile": one
 * template, one font, the bottom half of every slide empty. These drive
 * the fix as properties of the layout and the files, not of a picture:
 * every design a slide can be drawn as lays out without a fault in every
 * direction; no line runs past its box in the face it is drawn in; and
 * the PDF and the PowerPoint carry the same words, slide for slide.
 */

const SOURCE = "company record, stated by the founder";
const grounding = "Stated by the founder.";

/** Every design, once: a fictional company, figures given as stated. */
function gallery(direction: string, extra: Partial<QDeck> = {}): QDeck {
  return QDeckSchema.parse({
    direction,
    ...extra,
    slides: [
      {
        layout: "TITLE",
        title: "Northstar Logistics",
        subtitle:
          "Freight between Lagos and Abuja, booked and tracked in one place.",
        section: 0,
      },
      {
        layout: "STATEMENT",
        title: "What we do",
        bullets: ["We book and track road freight for mid-size shippers."],
        section: 1,
      },
      {
        layout: "BULLETS",
        title: "Why shippers switch",
        bullets: [
          "Fixed lane prices, agreed before loading.",
          "Live tracking shared with the receiver.",
          "One invoice a month, not one per truck.",
        ],
        section: 1,
      },
      {
        layout: "BULLETS",
        title: "Deliveries grew every month",
        figures: [
          { value: "655", label: "Deliveries in September" },
          { value: "92%", label: "On time, last 90 days" },
          { value: "41", label: "Shippers on contract" },
        ],
        bullets: ["Two enterprise pilots signed in August."],
        section: 2,
      },
      {
        layout: "BULLETS",
        title: "Traction",
        figures: [{ value: "655", label: "Deliveries in September" }],
        chart: {
          kind: "COLUMN",
          measure: "Deliveries",
          unit: "count",
          points: [
            { label: "June", value: "320" },
            { label: "September", value: "655" },
          ],
          grounding,
          source: SOURCE,
        },
        section: 2,
      },
      {
        layout: "CHART",
        title: "Monthly deliveries doubled since June",
        bullets: ["Growth came from repeat shippers."],
        chart: {
          kind: "LINE",
          measure: "Deliveries",
          unit: "count",
          points: [
            { label: "Jun", value: "320" },
            { label: "Jul", value: "410" },
            { label: "Aug", value: "520" },
            { label: "Sep", value: "655" },
          ],
          grounding,
          source: SOURCE,
        },
        section: 2,
      },
      {
        layout: "BULLETS",
        title: "Market",
        figures: [
          { value: "$4.1bn", label: "Road freight spend (TAM)" },
          { value: "$620m", label: "Lagos–Abuja corridor (SAM)" },
          { value: "$38m", label: "Shippers we can serve (SOM)" },
        ],
        section: 3,
      },
      {
        layout: "TWO_COLUMN",
        title: "Shippers lose a day per load to phone calls",
        bullets: [
          "Loads are booked by phone.",
          "No one knows where a truck is.",
        ],
        bulletsRight: ["One booking flow.", "Live tracking for the receiver."],
        section: 4,
      },
      {
        layout: "BULLETS",
        title: "Team",
        bullets: [
          "Ada Obi — CEO",
          "Tunde Bello — CTO",
          "Ngozi Eze — Head of Sales",
        ],
        section: 5,
      },
      {
        layout: "BULLETS",
        title: "Roadmap",
        visual: "FLOW",
        bullets: ["Open Kano lane", "Shipper credit", "Accra pilot"],
        section: 6,
      },
      {
        layout: "BULLETS",
        title: "Product",
        bullets: ["Book a truck in two minutes."],
        placeholder: {
          kind: "IMAGE",
          label: "Product screenshot: drop yours here",
        },
        section: 6,
      },
      {
        layout: "BULLETS",
        title: "We are raising $2.5m",
        figures: [{ value: "$2.5m", label: "Seed round, SAFE" }],
        chart: {
          kind: "DONUT",
          measure: "Use of funds",
          unit: "%",
          points: [
            { label: "Engineering", value: "40" },
            { label: "Sales", value: "35" },
            { label: "Reserve", value: "25" },
          ],
          grounding,
          source: SOURCE,
        },
        section: 7,
      },
      {
        layout: "QUOTE",
        title: "Customer",
        bullets: ["We stopped calling drivers."],
        attribution: "Head of Logistics, a Lagos distributor",
        section: 8,
      },
      {
        layout: "TITLE",
        title: "Thank you",
        subtitle: "ada@northstar.example",
        section: 0,
      },
    ],
  });
}

const DESIGNS = [
  "COVER",
  "STATEMENT",
  "LIST",
  "KPI",
  "KPI_CHART",
  "CHART",
  "MARKET",
  "TWO_COLUMN",
  "TEAM",
  "TIMELINE",
  "PRODUCT",
  "DONUT",
  "QUOTE",
  "CLOSING",
] as const;

const lines = (laid: LaidOutDeck, slide: number): string[] =>
  (laid.slides[slide]?.boxes ?? [])
    .filter((box): box is TextBox => box.kind === "TEXT")
    .flatMap((box) => box.lines);

describe("deck quality · every design", () => {
  for (const direction of [
    "MINIMAL_INSTITUTIONAL",
    "DARK_TECHNICAL",
    "WARM_GROWTH",
  ]) {
    it(`${direction}: draws all fourteen designs without a fault`, () => {
      const laid = layOutDeck(gallery(direction));
      expect(laid.slides.map((slide) => slide.design)).toEqual([...DESIGNS]);
      expect(inspectDeck(laid)).toEqual([]);
    });
  }

  it("with a brand accent too light to read, keeps it as a fill and darkens its text", () => {
    const laid = layOutDeck(gallery("MINIMAL_INSTITUTIONAL"), {
      accent: "#f5d90a",
    });
    expect(laid.theme.accent).toBe("#f5d90a");
    expect(
      contrastRatio(laid.theme.accentInk, laid.theme.background) ?? 0,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(laid.theme.onDeep, laid.theme.deep) ?? 0,
    ).toBeGreaterThanOrEqual(4.5);
    expect(inspectDeck(laid)).toEqual([]);
  });

  it("no line runs past its box in the face it is drawn in, nor off the slide", () => {
    const laid = layOutDeck(gallery("MINIMAL_INSTITUTIONAL"));
    for (const slide of laid.slides) {
      for (const box of slide.boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(SLIDE_WIDTH);
        expect(box.y + box.height).toBeLessThanOrEqual(SLIDE_HEIGHT);
        if (box.kind !== "TEXT") continue;
        expect(box.face).toBeDefined();
        for (const line of box.lines) {
          expect(measure(line, box.size, box.face)).toBeLessThanOrEqual(
            box.width + 1,
          );
        }
      }
    }
  });

  it("adds no words: every line drawn is the deck's own (or its page number)", () => {
    const deck = gallery("MINIMAL_INSTITUTIONAL");
    const laid = layOutDeck(deck);
    const source = JSON.stringify(deck);
    laid.slides.forEach((_, index) => {
      for (const line of lines(laid, index)) {
        for (const word of line.split(/\s+/)) {
          const bare = word.replace(/^[“"(—]+|[”"),.:%]+$/g, "");
          if (/^\d{2}$/.test(bare) || bare.length === 0) continue; // numbering
          if (/^[A-Z]{1,2}$/.test(bare)) continue; // monograms
          if (bare === "Source") continue; // "Source: …" under a chart
          expect(source).toContain(bare);
        }
      }
    });
  });

  it("names the theme's faces in the PowerPoint and embeds them in the PDF", async () => {
    const laid = layOutDeck(gallery("MINIMAL_INSTITUTIONAL"));
    const pdf = await PDFDocument.load(await deckToPdf(laid, { title: "t" }));
    const fonts = pdf.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter(
        (object): object is PDFDict =>
          object instanceof PDFDict &&
          object.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"),
      )
      .map((descriptor) => String(descriptor.get(PDFName.of("FontName"))));
    expect(fonts.some((name) => name.includes("SourceSerif4"))).toBe(true);
    expect(fonts.some((name) => name.includes("Inter"))).toBe(true);
    const xml = pptxSlides(await deckToPptx(laid, { title: "t" }));
    expect(xml.join("")).toContain('typeface="Source Serif 4"');
    expect(xml.join("")).toContain('typeface="Inter"');
    // The donut is a native block arc, the panels rounded rectangles.
    expect(xml.join("")).toContain('prst="blockArc"');
    expect(xml.join("")).toContain('prst="roundRect"');
  });
});

describe("deck quality · PDF and PowerPoint agree", () => {
  it("carry the same lines on the same slide", async () => {
    const laid = layOutDeck(gallery("WARM_GROWTH"));
    const [pdfBytes, pptxBytes] = await Promise.all([
      deckToPdf(laid, { title: "t" }),
      deckToPptx(laid, { title: "t" }),
    ]);
    const pdf = await pdfText(pdfBytes);
    const pptx = pptxSlides(pptxBytes).map(pptxText);
    expect(pdf).toHaveLength(laid.slides.length);
    expect(pptx).toHaveLength(laid.slides.length);
    laid.slides.forEach((slide, index) => {
      for (const line of lines(laid, index)) {
        const plain = line.replace(/\s+/g, " ").trim();
        if (plain.length === 0) continue;
        expect(pdf[index]?.replace(/\s+/g, "")).toContain(
          plain.replace(/\s+/g, ""),
        );
        expect(pptx[index]).toContain(plain);
      }
      expect(slide.dropped).toEqual([]);
    });
  });
});

/** Each page's text, as a PDF reader extracts it. */
async function pdfText(bytes: Uint8Array): Promise<readonly string[]> {
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= document.numPages; n += 1) {
    const content = await (await document.getPage(n)).getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  await task.destroy();
  return pages;
}

/** The text runs of one slide's XML, joined per paragraph. */
function pptxText(xml: string): string {
  return [...xml.matchAll(/<a:p>(.*?)<\/a:p>/gs)]
    .map((paragraph) =>
      [...(paragraph[1] ?? "").matchAll(/<a:t>(.*?)<\/a:t>/gs)]
        .map((run) => decode(run[1] ?? ""))
        .join(""),
    )
    .join("\n");
}

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * The slide XML parts of a .pptx, in slide order: a zip read with the
 * central directory and inflate, which is all a test needs.
 */
function pptxSlides(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const slides = new Map<number, string>();
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    if (match?.[1] !== undefined) {
      const local =
        offset +
        30 +
        buffer.readUInt16LE(offset + 26) +
        buffer.readUInt16LE(offset + 28);
      const data = buffer.subarray(local, local + size);
      slides.set(
        Number(match[1]),
        (method === 8 ? inflateRawSync(data) : data).toString("utf8"),
      );
    }
    at += 46 + nameLength + extra + comment;
  }
  return [...slides.entries()].sort(([a], [b]) => a - b).map(([, xml]) => xml);
}
