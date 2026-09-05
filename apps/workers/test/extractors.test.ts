import { describe, expect, it } from "vitest";

import { ParserOutputSchema } from "@capital-q/evidence/contracts";

import {
  createContentExtractorRegistry,
  createDocxExtractor,
  createPdfExtractor,
  createPptxExtractor,
  createTextExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import { buildPdf } from "./support/pdf.js";
import {
  buildDocx,
  buildPptx,
  buildZip,
  OOXML_MIME_TYPES,
  paragraph,
  slideXml,
  wordDocument,
} from "./support/zip.js";

/**
 * Extraction has to be *useful*, not merely safe: a later citation can only
 * say "slide 4" or "page 2" if the extractor kept that. These tests assert
 * the structure survives, and that nothing in a document is ever executed.
 */

const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };

const registry = createContentExtractorRegistry([
  createDocxExtractor(),
  createPptxExtractor(),
  createTextExtractor(),
]);

describe("text extractor", () => {
  it("keeps paragraphs with their line ranges", async () => {
    const extractor = createTextExtractor();
    const output = await extractor.extract(
      Buffer.from("First line\nstill first\n\nSecond block\n", "utf8"),
      context,
    );
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.blocks).toHaveLength(2);
    expect(output.blocks[0]).toMatchObject({
      kind: "paragraph",
      text: "First line\nstill first",
      locator: { index: 0, lineStart: 1, lineEnd: 2 },
    });
    expect(output.blocks[1]).toMatchObject({
      locator: { lineStart: 4, lineEnd: 4 },
    });
  });

  it("stops and says so when a limit is reached", async () => {
    const extractor = createTextExtractor();
    const many = Array.from(
      { length: 20 },
      (_v, i) => `line ${String(i)}`,
    ).join("\n\n");
    const output = await extractor.extract(Buffer.from(many, "utf8"), {
      limits: { ...EXTRACTION_PARSER_LIMITS, maxBlocks: 5 },
    });
    expect(output.blocks).toHaveLength(5);
    expect(output.metadata.truncated).toBe(true);
  });
});

describe("docx extractor", () => {
  it("recovers headings, paragraphs, lists and tables", async () => {
    const docx = buildDocx(
      wordDocument(
        [
          paragraph("Company overview", { style: "Heading1" }),
          paragraph("We sell software to funds."),
          paragraph("First point", { numbered: true }),
          paragraph("Second point", { numbered: true }),
          "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Year</w:t></w:r></w:p></w:tc>" +
            "<w:tc><w:p><w:r><w:t>Revenue</w:t></w:r></w:p></w:tc></w:tr>" +
            "<w:tr><w:tc><w:p><w:r><w:t>2025</w:t></w:r></w:p></w:tc>" +
            "<w:tc><w:p><w:r><w:t>2.0M</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
        ].join(""),
      ),
    );
    const extractor = createDocxExtractor();
    const output = await extractor.extract(docx, context);
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "table",
    ]);
    expect(output.blocks[0]).toMatchObject({
      level: 1,
      text: "Company overview",
    });
    expect(output.blocks[2]).toMatchObject({
      items: ["First point", "Second point"],
    });
    expect(output.blocks[3]).toMatchObject({
      rows: [
        ["Year", "Revenue"],
        ["2025", "2.0M"],
      ],
    });
  });

  it("reads a macro-enabled package's text without touching the macro", async () => {
    // The binary part is present and is never read, resolved or executed.
    const docx = buildDocx(wordDocument(paragraph("Ordinary text")), [
      { name: "word/vbaProject.bin", content: Buffer.from([0xd0, 0xcf, 0x11]) },
    ]);
    const output = await createDocxExtractor().extract(docx, context);
    expect(output.blocks).toHaveLength(1);
    expect(JSON.stringify(output)).not.toContain("vbaProject");
  });

  it("refuses a package with no document part", () => {
    const withoutDocument = buildZip([
      { name: "[Content_Types].xml", content: "<Types/>" },
    ]);
    expect(() =>
      createDocxExtractor().extract(withoutDocument, context),
    ).toThrowError(expect.objectContaining({ code: "MALFORMED_PACKAGE" }));
  });
});

describe("pptx extractor", () => {
  it("keeps slide numbers and slide order", async () => {
    const pptx = buildPptx([
      { name: "ppt/slides/slide10.xml", xml: slideXml(["Traction", "3x YoY"]) },
      {
        name: "ppt/slides/slide2.xml",
        xml: slideXml(["Problem", "Funds guess"]),
      },
      { name: "ppt/slides/slide1.xml", xml: slideXml(["Capital Q"]) },
    ]);
    const output = await createPptxExtractor().extract(pptx, context);
    expect(output.blocks.map((block) => block.locator.slide)).toEqual([
      1, 2, 10,
    ]);
    expect(output.blocks[1]).toMatchObject({
      kind: "slide",
      slideNumber: 2,
      title: "Problem",
      text: "Problem\nFunds guess",
    });
    expect(output.metadata.slideCount).toBe(3);
  });
});

describe("pdf extractor", () => {
  it("keeps page boundaries", async () => {
    const pdf = buildPdf([
      ["Capital Q quarterly review", "Revenue grew to 2.0M"],
      ["Team and hiring", "Twelve people across product and sales"],
    ]);
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
      const document = await task.promise;
      return {
        numPages: (document as unknown as { numPages: number }).numPages,
        getPage: (n: number) =>
          (
            document as unknown as { getPage: (n: number) => Promise<never> }
          ).getPage(n),
        destroy: () => task.destroy(),
      };
    });

    const output = await extractor.extract(pdf, context);
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.metadata.pageCount).toBe(2);
    const pages = output.blocks.map((block) => block.locator.page);
    expect(pages).toContain(1);
    expect(pages).toContain(2);
    expect(output.blocks.some((block) => block.kind === "page_break")).toBe(
      true,
    );
    const text = output.blocks
      .map((block) => ("text" in block ? block.text : ""))
      .join(" ");
    expect(text).toContain("Revenue grew to 2.0M");
    expect(text).toContain("Twelve people");
  });
});

describe("registry", () => {
  it("resolves the extractor for each supported type", () => {
    expect(
      registry.resolve({
        mimeType: OOXML_MIME_TYPES.docx,
        filename: "a.docx",
        sizeBytes: 1,
      })?.id,
    ).toBe("ooxml_docx");
    expect(
      registry.resolve({
        mimeType: OOXML_MIME_TYPES.pptx,
        filename: "a.pptx",
        sizeBytes: 1,
      })?.id,
    ).toBe("ooxml_pptx");
    expect(
      registry.resolve({
        mimeType: "text/plain",
        filename: "a.txt",
        sizeBytes: 1,
      })?.id,
    ).toBe("text");
  });

  it("resolves nothing for a spreadsheet, which is deferred, not silently empty", () => {
    expect(
      registry.resolve({
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "model.xlsx",
        sizeBytes: 1,
      }),
    ).toBeNull();
  });

  it("resolves nothing for a macro-enabled document type", () => {
    expect(
      registry.resolve({
        mimeType: "application/vnd.ms-word.document.macroEnabled.12",
        filename: "a.docm",
        sizeBytes: 1,
      }),
    ).toBeNull();
  });
});
