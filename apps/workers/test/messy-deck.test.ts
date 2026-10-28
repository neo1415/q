import { describe, expect, it } from "vitest";

import { ParserOutputSchema } from "@capital-q/evidence/contracts";
import { passagesFrom } from "@capital-q/founder-onboarding";
import { parseMoney, parseMoneyAll } from "@capital-q/onboarding";
import { planChunks } from "@capital-q/q-knowledge";

import {
  createPdfExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import { pdfjsAssetOptions } from "../src/parser/pdfjs-assets.js";
import { buildPlacedPdf, type PlacedText } from "./support/pdf.js";

/**
 * A synthetic messy deck, end to end and deterministic (deck reading
 * 2026-10-28): a 60-page PDF exported from a design tool, two-column
 * pages, a figures table with decimal-comma euros and ₦ amounts, an
 * image-only page, and the traction and the ask on the last pages. The
 * real pdf.js reads it; the real chunker and the founder reading select
 * from it; the money parser reads its figures. No model is called.
 */

const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };

async function loadPdf(bytes: Uint8Array) {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs: unknown = await import(specifier);
  const getDocument = (pdfjs as { getDocument: (o: unknown) => unknown })
    .getDocument;
  const task = getDocument({
    data: bytes,
    ...pdfjsAssetOptions(),
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
}

function fillerPage(page: number): PlacedText[] {
  const left = Array.from({ length: 8 }, (_u, at) => ({
    x: 60,
    y: 700 - at * 14,
    text: `Page ${String(page)} left column line ${String(at + 1)} about the market.`,
  }));
  const right = Array.from({ length: 8 }, (_u, at) => ({
    x: 330,
    y: 696 - at * 14,
    text: `Page ${String(page)} right column line ${String(at + 1)} on operations.`,
  }));
  return [
    { x: 60, y: 750, text: `Section ${String(page)}`, size: 20 },
    ...left,
    ...right,
  ];
}

const pages: PlacedText[][] = Array.from({ length: 60 }, (_u, at) =>
  fillerPage(at + 1),
);
// Page 30: a picture-only slide (a screenshot with a page number).
pages[29] = [{ x: 300, y: 30, text: "30" }];
// Page 41: a figures table, decimal-comma euros and naira. The test PDF's
// Type1 font holds only Latin-1 glyphs, so the table spells EUR and NGN;
// the ₦ and € symbols are checked through the parser in the last test.
pages[40] = [
  { x: 60, y: 750, text: "Unit economics", size: 20 },
  { x: 60, y: 700, text: "Metric" },
  { x: 260, y: 700, text: "2024" },
  { x: 420, y: 700, text: "2025" },
  { x: 60, y: 680, text: "Revenue" },
  { x: 260, y: 680, text: "0,9 M EUR" },
  { x: 420, y: 680, text: "1,5 M EUR" },
  { x: 60, y: 660, text: "Lagos revenue" },
  { x: 260, y: 660, text: "NGN 120m" },
  { x: 420, y: 660, text: "NGN 450m" },
];
// Page 59: traction. Page 60: the ask.
pages[58] = [
  { x: 60, y: 750, text: "Traction", size: 20 },
  { x: 60, y: 700, text: "38 paying hospitals; net retention 121%." },
];
pages[59] = [
  { x: 60, y: 750, text: "The ask", size: 20 },
  { x: 60, y: 700, text: "Raising 2 500 000 EUR seed to reach 200 hospitals." },
];

describe("a 60-page messy deck, read end to end", () => {
  it("keeps its columns apart, its table rows whole, and names the picture page", async () => {
    const output = await createPdfExtractor(loadPdf).extract(
      buildPlacedPdf(pages),
      context,
    );
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.metadata.lowTextPages).toEqual([30]);
    const page5 = output.blocks
      .filter((b) => b.locator.page === 5)
      .map((b) => ("text" in b ? b.text : ""))
      .join(" ");
    expect(page5.indexOf("left column line 8")).toBeLessThan(
      page5.indexOf("right column line 1"),
    );
    const table = output.blocks
      .filter((b) => b.locator.page === 41)
      .map((b) => ("text" in b ? b.text : ""));
    expect(table).toContain("Revenue | 0,9 M EUR | 1,5 M EUR");
    expect(
      parseMoneyAll(table.join("\n")).filter((m) => m.currency !== null),
    ).toMatchObject([
      { amount: "900000", currency: "EUR" },
      { amount: "1500000", currency: "EUR" },
      { amount: "120000000", currency: "NGN" },
      { amount: "450000000", currency: "NGN" },
    ]);
  });

  it("the founder reading covers the end of the deck, within budget, one passage per place", async () => {
    const output = await createPdfExtractor(loadPdf).extract(
      buildPlacedPdf(pages),
      context,
    );
    const plan = planChunks(output.blocks);
    for (const chunk of plan.chunks) {
      expect(chunk.locator.pageStart).toBe(chunk.locator.pageEnd);
    }
    const passages = passagesFrom([
      {
        documentId: "33333333-3333-4333-8333-333333333333",
        documentVersionId: "44444444-4444-4444-8444-444444444444",
        title: "deck",
        chunks: plan.chunks.map((chunk) => ({
          content: chunk.content,
          chunkIndex: chunk.index,
          role: chunk.role,
          locator: chunk.locator,
        })),
      },
    ]);
    const text = passages.map((p) => p.text).join("\n");
    expect(text).toContain("38 paying hospitals");
    expect(text).toContain("Raising 2 500 000 EUR seed");
    expect(passages.length).toBeLessThanOrEqual(40);
    expect(text.length).toBeLessThanOrEqual(40_000);
    expect(passages.at(-1)?.label).toMatch(/pages? (\d+–)?60$/);
  });

  it("reads the deck's figures with their own currency, exactly", () => {
    expect(parseMoney("Revenue | 0,9 M€ | 1,5 M€")).toMatchObject({
      amount: "900000",
      currency: "EUR",
    });
    expect(
      parseMoneyAll("Lagos revenue | ₦120m | ₦450m").map((m) => [
        m.amount,
        m.currency,
      ]),
    ).toEqual([
      ["120000000", "NGN"],
      ["450000000", "NGN"],
    ]);
    expect(
      parseMoney("Raising 2 500 000 EUR seed to reach 200 hospitals."),
    ).toMatchObject({ amount: "2500000", currency: "EUR" });
  });
});
