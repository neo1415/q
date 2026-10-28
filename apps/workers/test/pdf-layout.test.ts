import { describe, expect, it } from "vitest";

import { ParserOutputSchema } from "@capital-q/evidence/contracts";
import { planChunks } from "@capital-q/q-knowledge";

import {
  createPdfExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import {
  isPredominantlyRtl,
  pageBlocks,
  type PdfTextItem,
} from "../src/parser/pdf-layout.js";
import { buildPlacedPdf, type PlacedText } from "./support/pdf.js";

/**
 * Real decks are messy: two-column one-pagers, tables of figures, Arabic
 * slides, headings set large. These fixtures are synthetic and
 * deterministic; the PDFs are real files read by the real pdf.js.
 */

const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };

const item = (
  str: string,
  x: number,
  y: number,
  size = 11,
  width = str.length * size * 0.5,
): PdfTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

async function extractPdf(pages: readonly (readonly PlacedText[])[]) {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs: unknown = await import(specifier);
  const getDocument = (pdfjs as { getDocument: (o: unknown) => unknown })
    .getDocument;
  const extractor = createPdfExtractor(async (bytes) => {
    const task = getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    }) as { promise: Promise<never>; destroy: () => Promise<void> };
    const document = (await task.promise) as unknown as {
      numPages: number;
      getPage: (n: number) => Promise<never>;
    };
    return {
      numPages: document.numPages,
      getPage: (n: number) => document.getPage(n),
      destroy: () => task.destroy(),
    };
  });
  const output = await extractor.extract(buildPlacedPdf(pages), context);
  expect(ParserOutputSchema.safeParse(output).success).toBe(true);
  return output;
}

const textOf = (blocks: readonly { kind: string }[]): string[] =>
  blocks.map((b) => ("text" in b ? String(b.text) : ""));

describe("pdf layout · reading order from geometry", () => {
  it("orders runs on one line left to right, whatever order they were drawn in", () => {
    const blocks = pageBlocks([
      item("grew to", 120, 700),
      item("Revenue", 72, 700),
      item("NGN 450m", 165, 700),
    ]);
    expect(textOf(blocks)).toEqual(["Revenue grew to NGN 450m"]);
  });

  it("orders a right-to-left line right to left, by Unicode script", () => {
    expect(isPredominantlyRtl("الإيرادات 450 مليون")).toBe(true);
    expect(isPredominantlyRtl("Revenue 450 مليون")).toBe(false);
    const blocks = pageBlocks([
      item("مليون", 72, 700, 11, 30),
      item("الإيرادات", 160, 700, 11, 45),
      item("450", 120, 700, 11, 18),
    ]);
    expect(textOf(blocks)).toEqual(["الإيرادات 450 مليون"]);
  });

  it("keeps table cells apart instead of merging a row into a sentence", () => {
    const blocks = pageBlocks([
      item("Metric", 72, 700),
      item("2024", 300, 700),
      item("2025", 420, 700),
      item("ARR", 72, 680),
      item("$1.2m", 300, 680),
      item("$3.1m", 420, 680),
    ]);
    expect(textOf(blocks)).toEqual([
      "Metric | 2024 | 2025",
      "ARR | $1.2m | $3.1m",
    ]);
  });

  it("splits paragraphs on a vertical gap and reads a larger short line as a heading", () => {
    const blocks = pageBlocks([
      item("Traction", 72, 740, 24),
      item("We serve 38 hospitals across Lagos and Abuja.", 72, 700),
      item("Retention is 96 percent over twelve months.", 72, 686),
      item("The ask is a USD 3m seed round.", 72, 640),
    ]);
    expect(blocks).toEqual([
      { kind: "heading", text: "Traction" },
      {
        kind: "paragraph",
        text: "We serve 38 hospitals across Lagos and Abuja. Retention is 96 percent over twelve months.",
      },
      { kind: "paragraph", text: "The ask is a USD 3m seed round." },
    ]);
  });

  it("reads two prose columns one after the other, even on different baselines", () => {
    const left = [
      "Clinics in Nairobi lose a third",
      "of all test results before the",
      "doctor sees them, according to",
      "our audit of fourteen facilities.",
    ];
    const right = [
      "Our strip reader files each",
      "result into the record by itself",
      "and has been live in nine",
      "clinics since March this year.",
    ];
    const items = [
      ...left.map((line, at) => item(line, 72, 700 - at * 14)),
      // The right column's baselines are offset by 5pt from the left's.
      ...right.map((line, at) => item(line, 330, 695 - at * 14)),
    ];
    const text = textOf(pageBlocks(items)).join(" ");
    expect(text).toBe(`${left.join(" ")} ${right.join(" ")}`);
  });
});

describe("pdf extractor · a messy multi-column deck page", () => {
  it("reads columns in order, keeps the heading and page, and chunks per page", async () => {
    const page1: PlacedText[] = [
      { x: 72, y: 740, text: "Market and traction", size: 22 },
      { x: 72, y: 700, text: "Nigeria has 34,000 private clinics" },
      { x: 72, y: 686, text: "and most still keep paper records" },
      { x: 72, y: 672, text: "that are lost or never filed at all." },
      { x: 72, y: 658, text: "We sell to the top tier first." },
      { x: 330, y: 700, text: "Revenue reached NGN 1.5 billion" },
      { x: 330, y: 686, text: "in 2025 from thirty eight clinics" },
      { x: 330, y: 672, text: "with net retention above 120 percent" },
      { x: 330, y: 658, text: "and gross margin of 61 percent." },
    ];
    const page2: PlacedText[] = [
      { x: 72, y: 700, text: "The ask: USD 3m seed to reach 200 clinics." },
    ];
    const output = await extractPdf([page1, page2]);
    const blocks = output.blocks;
    expect(blocks[0]).toMatchObject({
      kind: "heading",
      text: "Market and traction",
      locator: { page: 1 },
    });
    const prose = textOf(blocks.filter((b) => b.locator.page === 1)).join(" ");
    expect(prose.indexOf("We sell to the top tier first.")).toBeLessThan(
      prose.indexOf("Revenue reached NGN 1.5 billion"),
    );
    expect(prose).not.toMatch(/clinics Revenue reached/);

    const plan = planChunks(blocks);
    // No chunk spans a page; the ask is its own page-2 chunk.
    for (const chunk of plan.chunks) {
      expect(chunk.locator.pageStart).toBe(chunk.locator.pageEnd);
    }
    const ask = plan.chunks.find((c) => c.content.includes("The ask"));
    expect(ask?.locator.pageStart).toBe(2);
  });
});
