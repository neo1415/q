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
 * An unpaged document's reading section: whole blocks, in order, up to
 * this many characters (one block longer than this is its own section).
 */
export const UNPAGED_SECTION_CHARS = 4_000;

/**
 * Owner live 9 Nov: a Word file attached in Q's chat had its text
 * extracted, yet Q said "it may be a scan" -- it had no pages, and every
 * reader (the attached-file read, the Q room, read aloud) reads pages. A
 * document whose blocks carry no page or slide at all (Word, plain text,
 * Markdown, a workbook) is read in sections of whole blocks, numbered as
 * its pages; a block is never split between two.
 */
function sectionOf(blocks: readonly ExtractedBlock[]): Map<number, string[]> {
  const byPage = new Map<number, string[]>();
  let page = 1;
  let size = 0;
  for (const block of blocks) {
    const text = textOf(block).trim();
    if (text.length === 0) continue;
    const length = codePoints(text).length;
    if (size > 0 && size + length > UNPAGED_SECTION_CHARS) {
      page += 1;
      size = 0;
    }
    const parts = byPage.get(page) ?? [];
    parts.push(text);
    byPage.set(page, parts);
    size += length;
  }
  return byPage;
}

/**
 * The pages of a document: a paged one's (PDF, slides) as its parser
 * located them; an unpaged one's (Word, text, a workbook) as reading
 * sections of whole blocks.
 */
export function pagesFromBlocks(
  blocks: readonly ExtractedBlock[],
): readonly DocumentPageText[] {
  const paged = blocks.some((block) => pageOf(block) !== null);
  const byPage = paged ? new Map<number, string[]>() : sectionOf(blocks);
  for (const block of paged ? blocks : []) {
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

/**
 * A whole document's text, in block order, whether or not its blocks carry
 * a page (ob2 2026-10-16: a Word or plain-text thesis has no pages, and is
 * read from its extraction instead). The same plain text a page holds, no
 * interpretation, bounded to `maxChars` code points.
 */
export function documentTextFromBlocks(
  blocks: readonly ExtractedBlock[],
  maxChars: number,
): string {
  const parts = blocks
    .map((block) => textOf(block).trim())
    .filter((text) => text.length > 0);
  return codePoints(parts.join("\n\n"))
    .slice(0, Math.max(0, maxChars))
    .join("");
}
