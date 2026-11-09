import { describe, expect, it } from "vitest";

import { pagesFromBlocks } from "@capital-q/evidence";

import { createDocxExtractor } from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import { buildDocx, paragraph, wordDocument } from "./support/zip.js";

/**
 * Owner live 9 Nov: "TERMS AND CONDITIONS" (.docx, 25 KB) attached in Q's
 * chat was marked COMPLETED with no pages, and Q said "it may be a scan".
 * A Word file's text reaches pages Q reads, including text Word keeps in
 * content controls (w:sdt) and custom XML.
 */

const context = { limits: EXTRACTION_PARSER_LIMITS };

describe("a .docx yields pages Q reads", () => {
  it("plain paragraphs: one page of its text", async () => {
    const output = await createDocxExtractor().extract(
      buildDocx(
        wordDocument(
          paragraph("TERMS AND CONDITIONS", { style: "Heading1" }) +
            paragraph("These terms apply to every order."),
        ),
      ),
      context,
    );
    const pages = pagesFromBlocks(output.blocks);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain("These terms apply to every order.");
  });

  it("text inside content controls and custom XML is read, in order", async () => {
    const wrapped =
      `<w:sdt><w:sdtPr/><w:sdtContent>${paragraph("1. Definitions")}` +
      `<w:sdt><w:sdtContent>${paragraph("Nested clause.")}</w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt>` +
      `<w:customXml>${paragraph("2. Payment")}</w:customXml>`;
    const output = await createDocxExtractor().extract(
      buildDocx(wordDocument(paragraph("Preamble") + wrapped)),
      context,
    );
    const text = pagesFromBlocks(output.blocks)
      .map((page) => page.text)
      .join("\n");
    expect(text).toBe("Preamble\n1. Definitions\nNested clause.\n2. Payment");
  });
});
