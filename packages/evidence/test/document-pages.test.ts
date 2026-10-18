import { describe, expect, it } from "vitest";

import {
  DOCUMENT_PAGE_MAX_CHARS,
  pagesFromBlocks,
  type ExtractedBlock,
} from "../src/index.js";

const at = (index: number, page?: number, slide?: number) => ({
  index,
  ...(page === undefined ? {} : { page }),
  ...(slide === undefined ? {} : { slide }),
});

describe("pagesFromBlocks (Q room W3)", () => {
  it("cuts a PDF's blocks into its pages, in order, with honest offsets", () => {
    const blocks: ExtractedBlock[] = [
      { kind: "heading", level: 1, text: "Certificate", locator: at(0, 1) },
      { kind: "paragraph", text: "Ledgerline Ltd", locator: at(1, 1) },
      { kind: "page_break", locator: at(2, 1) },
      {
        kind: "table",
        rows: [
          ["Class", "Shares"],
          ["Ordinary", "10,000,000"],
        ],
        locator: at(3, 2),
      },
      {
        kind: "list",
        ordered: true,
        items: ["Tobenna", "Inês"],
        locator: at(4, 2),
      },
    ];
    const pages = pagesFromBlocks(blocks);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(pages[0]?.text).toBe("Certificate\nLedgerline Ltd");
    expect(pages[1]?.text).toBe(
      "Class | Shares\nOrdinary | 10,000,000\n1. Tobenna\n2. Inês",
    );
    expect(pages[0]?.charStart).toBe(0);
    expect(pages[0]?.charEnd).toBe(26);
    // A blank line between pages; offsets count code points.
    expect(pages[1]?.charStart).toBe(28);
    expect(pages[1]?.charEnd).toBe(
      28 + Array.from(pages[1]?.text ?? "").length,
    );
  });

  it("uses slides for a deck", () => {
    const pages = pagesFromBlocks([
      {
        kind: "slide",
        slideNumber: 2,
        title: "Traction",
        text: "118% NRR",
        locator: at(0, undefined, 2),
      },
      { kind: "slide", slideNumber: 1, text: "Ledgerline", locator: at(1) },
    ]);
    expect(pages.map((page) => [page.pageNumber, page.text])).toEqual([
      [1, "Ledgerline"],
      [2, "Traction\n118% NRR"],
    ]);
  });

  it("invents no pages for an unpaged document", () => {
    expect(
      pagesFromBlocks([
        { kind: "paragraph", text: "Plain text", locator: at(0) },
      ]),
    ).toEqual([]);
  });

  it("keeps an empty page as a page and bounds a long one", () => {
    const long = "x".repeat(DOCUMENT_PAGE_MAX_CHARS + 10);
    const pages = pagesFromBlocks([
      { kind: "page_break", locator: at(0, 1) },
      { kind: "paragraph", text: long.slice(0, 20_000), locator: at(1, 2) },
      { kind: "paragraph", text: long.slice(0, 20_000), locator: at(2, 2) },
      { kind: "paragraph", text: long.slice(0, 20_000), locator: at(3, 2) },
      { kind: "paragraph", text: long.slice(0, 20_000), locator: at(4, 2) },
    ]);
    expect(pages[0]).toMatchObject({ pageNumber: 1, text: "", charEnd: 0 });
    expect(pages[1]?.text.length).toBe(DOCUMENT_PAGE_MAX_CHARS);
    expect((pages[1]?.charEnd ?? 0) - (pages[1]?.charStart ?? 0)).toBe(
      DOCUMENT_PAGE_MAX_CHARS,
    );
  });
});
