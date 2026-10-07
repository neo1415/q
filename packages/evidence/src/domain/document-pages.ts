import type { ExtractedBlock } from "../contracts/extraction.js";

/**
 * Q room W3 (R3): a paged document's text, page by page, derived from the
 * structured extraction with no interpretation: the blocks a parser
 * located on a page (or slide), in order, as plain text. A summary line
 * can then cite "p. 2" and be checked against what page 2 says.
 *
 * Offsets count Unicode code points, as Postgres `char_length` does, over
 * the pages joined in order with a blank line between them.
 */

/** One page's text never exceeds this (the table's check is the same). */
export const DOCUMENT_PAGE_MAX_CHARS = 60_000;
/** Pages joined with this between them, for offsets. */
const PAGE_SEPARATOR_CHARS = 2;

export type DocumentPageText = {
  readonly pageNumber: number;
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
};

function pageOf(block: ExtractedBlock): number | null {
  if (block.locator.page !== undefined) return block.locator.page;
  if (block.locator.slide !== undefined) return block.locator.slide;
  if (block.kind === "slide") return block.slideNumber;
  return null;
}

function textOf(block: ExtractedBlock): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "footnote":
      return block.text;
    case "list":
      return block.items
        .map((item, index) =>
          block.ordered ? `${String(index + 1)}. ${item}` : `• ${item}`,
        )
        .join("\n");
    case "table":
    case "spreadsheet_range":
      return block.rows.map((row) => row.join(" | ")).join("\n");
    case "slide":
      return block.title === undefined
        ? block.text
        : `${block.title}\n${block.text}`;
    case "page_break":
      return "";
  }
}

const codePoints = (text: string) => Array.from(text);

/**
 * The pages of a paged document. A document whose blocks carry no page or
 * slide (plain text, a workbook, a Word file) has none: its text is not
 * cut into pages that do not exist.
 */
export function pagesFromBlocks(
  blocks: readonly ExtractedBlock[],
): readonly DocumentPageText[] {
  const byPage = new Map<number, string[]>();
  for (const block of blocks) {
    const page = pageOf(block);
    if (page === null) continue;
    const text = textOf(block).trim();
    const parts = byPage.get(page) ?? [];
    if (text.length > 0) parts.push(text);
    byPage.set(page, parts);
  }
  const pages: DocumentPageText[] = [];
  let at = 0;
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const joined = codePoints((byPage.get(page) ?? []).join("\n"));
    const text = joined.slice(0, DOCUMENT_PAGE_MAX_CHARS).join("");
    const length = Math.min(joined.length, DOCUMENT_PAGE_MAX_CHARS);
    pages.push({
      pageNumber: page,
      text,
      charStart: at,
      charEnd: at + length,
    });
    at += length + PAGE_SEPARATOR_CHARS;
  }
  return pages;
}
