/**
 * The small Markdown subset Q's writers use, read for print (live
 * 2026-10-31, IC memo PDF: 41 raw `**` and "- " bullets on the page).
 *
 * The same subset the in-app viewer renders (apps/web
 * features/q/markdown.tsx): headings, bullet and numbered lists, tables,
 * bold, italics, inline code, links and quoted callouts. A PDF has no
 * HTML, so it is parsed into a handful of block kinds and inline runs
 * (plain or bold) and nothing else; links keep their words. Hand-rolled
 * for the reason the viewer's is: the subset is small, and a Markdown
 * library would add a dependency for less than a page of rules.
 */

export type InlineRun = { readonly text: string; readonly bold: boolean };

export type PrintBlock =
  | { readonly kind: "heading"; readonly runs: readonly InlineRun[] }
  | { readonly kind: "paragraph"; readonly runs: readonly InlineRun[] }
  | {
      readonly kind: "item";
      /** "•" or "3." */
      readonly marker: string;
      /** Nesting depth, from 0. */
      readonly depth: number;
      readonly runs: readonly InlineRun[];
    };

const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/u;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/u;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/u;
const TABLE_ROW = /^\s*\|(.*)\|?\s*$/u;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/u;
const FENCE = /^ {0,3}(```|~~~)/u;

/** Links, code and italics to their words; bold stays marked. */
function unwrapInline(text: string): string {
  return (
    text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/`([^`]*)`/gu, "$1")
      // Italics (single * or _ around words), never a bold pair.
      .replace(/(^|[^\w*])\*(?!\*)(\S(?:.*?\S)?)\*(?!\*)(?=[^\w*]|$)/gu, "$1$2")
      .replace(/(^|[^\w_])_(?!_)(\S(?:.*?\S)?)_(?!_)(?=[^\w_]|$)/gu, "$1$2")
  );
}

/**
 * One line's inline syntax as runs. An unclosed `**` is not bold: its
 * marker is dropped and the words stay plain.
 */
export function inlineRuns(text: string): readonly InlineRun[] {
  const source = unwrapInline(text);
  const runs: InlineRun[] = [];
  const push = (words: string, bold: boolean) => {
    if (words.length === 0) return;
    const last = runs.at(-1);
    if (last !== undefined && last.bold === bold) {
      runs[runs.length - 1] = { text: last.text + words, bold };
    } else {
      runs.push({ text: words, bold });
    }
  };
  const pattern = /(\*\*|__)(.+?)\1/gu;
  let at = 0;
  for (const match of source.matchAll(pattern)) {
    push(source.slice(at, match.index).replace(/\*\*|__/gu, ""), false);
    push(match[2] ?? "", true);
    at = match.index + match[0].length;
  }
  push(source.slice(at).replace(/\*\*|__/gu, ""), false);
  return runs;
}

/** The words of one line, none of the syntax. */
export function plainInline(text: string): string {
  return inlineRuns(text)
    .map((run) => run.text)
    .join("");
}

const cellsOf = (row: string): readonly string[] =>
  row
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

/** Markdown as blocks to print, in order. Plain prose is one paragraph. */
export function printBlocks(source: string): readonly PrintBlock[] {
  const blocks: PrintBlock[] = [];
  let paragraph: string[] = [];
  /** The list item a plain next line continues (lazy continuation). */
  let item: { marker: string; depth: number; text: string } | null = null;
  const flush = () => {
    if (item !== null) {
      blocks.push({
        kind: "item",
        marker: item.marker,
        depth: item.depth,
        runs: inlineRuns(item.text),
      });
      item = null;
    }
    if (paragraph.length === 0) return;
    blocks.push({
      kind: "paragraph",
      runs: inlineRuns(paragraph.join(" ")),
    });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = raw.replace(/\s+$/u, "");
    if (line.trim().length === 0 || FENCE.test(line) || RULE.test(line)) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", runs: inlineRuns(heading[1] ?? "") });
      continue;
    }
    if (TABLE_SEPARATOR.test(line) && line.includes("-")) {
      flush();
      continue;
    }
    const row = TABLE_ROW.exec(line);
    if (row !== null && line.trim().startsWith("|")) {
      flush();
      // A table row prints as one item: its cells in order.
      blocks.push({
        kind: "item",
        marker: "•",
        depth: 0,
        runs: inlineRuns(cellsOf(row[1] ?? "").join(" · ")),
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null && !RULE.test(line)) {
      flush();
      item = {
        marker: "•",
        depth: Math.min(3, Math.floor((bullet[1] ?? "").length / 2)),
        text: bullet[2] ?? "",
      };
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered !== null) {
      flush();
      item = {
        marker: `${numbered[2] ?? ""}.`,
        depth: Math.min(3, Math.floor((numbered[1] ?? "").length / 2)),
        text: numbered[3] ?? "",
      };
      continue;
    }
    if (item !== null) {
      item.text = `${item.text} ${line.trim()}`;
      continue;
    }
    // A quoted callout prints as its words; "[!WARNING]" as "Warning:".
    paragraph.push(
      line
        .replace(/^ {0,3}>\s?/u, "")
        .replace(
          /^\[!([A-Za-z]+)\]\s*/u,
          (_marker, kind: string) =>
            `${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()}: `,
        )
        .trim(),
    );
  }
  flush();
  return blocks;
}

/**
 * Markdown as plain words on one line: for a quoted point, a summary or a
 * finding that prints as a sentence. A list marker that opens a quote
 * ("e.g. \"- **Cheque…**\"") goes with the rest of the syntax.
 */
export function plainMarkdown(source: string): string {
  return printBlocks(source)
    .map((block) =>
      block.runs
        .map((run) => run.text)
        .join("")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/(["“'‘])\s*(?:[-*+•]|\d{1,9}[.)])\s+/gu, "$1")
    .replace(/(["“'‘])(\*\*|__)/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}
