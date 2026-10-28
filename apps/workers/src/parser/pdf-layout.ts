/**
 * Reading order for one PDF page, recovered from pdf.js text items.
 *
 * pdf.js reports positioned runs of text, not lines or paragraphs. A deck
 * exported from Keynote, a two-column one-pager or a table of figures all
 * arrive as runs in drawing order, which is often not reading order. This
 * module rebuilds, by geometry alone (no model, no word lists):
 *
 *   lines       runs whose baselines sit within half a font height,
 *               ordered left to right, or right to left when the line's
 *               letters are predominantly from a right-to-left script
 *               (Unicode Script property, counted per character);
 *   cells       a horizontal gap of more than two font heights inside a
 *               line separates cells, kept apart with " | " so a table row
 *               never reads as one run-on sentence;
 *   columns     when many lines break at the same horizontal position and
 *               the text either side is prose-wide, the page is read
 *               column by column instead of across the gutter;
 *   paragraphs  a vertical gap well beyond the page's usual line spacing,
 *               or a change of font size, starts a new paragraph;
 *   headings    a short line set clearly larger than the page's body text.
 *
 * Deterministic, pure and bounded by the items it is given.
 */

export type PdfTextItem = {
  readonly str?: unknown;
  readonly transform?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
};

export type PageBlock =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string };

type Run = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly size: number;
};

type Segment = {
  readonly x: number;
  readonly end: number;
  readonly text: string;
};

type Line = {
  readonly y: number;
  readonly size: number;
  readonly rtl: boolean;
  readonly segments: readonly Segment[];
};

const RTL_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
const LETTER = /\p{L}/u;

/** True when most of the text's letters belong to a right-to-left script. */
export function isPredominantlyRtl(text: string): boolean {
  let rtl = 0;
  let letters = 0;
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    letters += 1;
    if (RTL_LETTER.test(char)) rtl += 1;
  }
  return letters > 0 && rtl * 2 > letters;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function runsOf(items: readonly PdfTextItem[]): Run[] {
  const runs: Run[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.trim().length === 0) continue;
    const t = Array.isArray(item.transform)
      ? (item.transform as unknown[])
      : [];
    const scaleY = Math.abs(num(t[3], 0));
    const scaleX = Math.abs(num(t[0], 0));
    const size = Math.max(1, num(item.height, 0) || scaleY || scaleX || 10);
    const width = Math.max(0, num(item.width, item.str.length * size * 0.5));
    runs.push({
      text: item.str,
      x: num(t[4], 0),
      y: num(t[5], 0),
      width,
      size,
    });
  }
  return runs;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Runs on (nearly) the same baseline, top of the page first. */
function linesOf(runs: readonly Run[]): Line[] {
  const byY = runs.toSorted((a, b) => b.y - a.y || a.x - b.x);
  const groups: Run[][] = [];
  for (const run of byY) {
    const current = groups[groups.length - 1];
    const anchor = current?.[0];
    if (
      current !== undefined &&
      anchor !== undefined &&
      Math.abs(anchor.y - run.y) <=
        Math.max(2, 0.5 * Math.min(anchor.size, run.size))
    ) {
      current.push(run);
    } else {
      groups.push([run]);
    }
  }
  return groups.map((group) => {
    const rtl = isPredominantlyRtl(group.map((r) => r.text).join(""));
    const size = median(group.map((r) => r.size));
    const ordered = group.toSorted((a, b) => a.x - b.x);
    // Segments in geometric (left-to-right) order; a gap of more than two
    // font heights is a cell or column boundary, a small one a word space.
    const segments: { x: number; end: number; parts: Run[] }[] = [];
    for (const run of ordered) {
      const open = segments[segments.length - 1];
      const gap = open === undefined ? 0 : run.x - open.end;
      if (open === undefined || gap > 2 * size) {
        segments.push({ x: run.x, end: run.x + run.width, parts: [run] });
      } else {
        open.parts.push(run);
        open.end = Math.max(open.end, run.x + run.width);
      }
    }
    return {
      y: median(group.map((r) => r.y)),
      size,
      rtl,
      segments: segments.map((segment) => {
        const parts = rtl ? segment.parts.toReversed() : segment.parts;
        let text = "";
        let previous: Run | undefined;
        for (const part of parts) {
          if (previous !== undefined) {
            const gap = rtl
              ? previous.x - (part.x + part.width)
              : part.x - (previous.x + previous.width);
            // Runs split mid-word by kerning touch; words are spaced.
            if (
              gap > 0.15 * size &&
              !text.endsWith(" ") &&
              !part.text.startsWith(" ")
            ) {
              text += " ";
            }
          }
          text += part.text;
          previous = part;
        }
        return {
          x: segment.x,
          end: segment.end,
          text: text.replace(/\s+/g, " ").trim(),
        };
      }),
    };
  });
}

/**
 * A gutter: a vertical strip in the middle half of the page that almost no
 * line crosses, with at least four lines of words on each side. Columns
 * whose lines sit on different baselines are found as well as aligned
 * ones, because coverage is measured per segment, not per line. Short
 * labels beside figures are a table, not prose columns, and stay rows.
 */
function gutterOf(lines: readonly Line[]): number | null {
  const segments = lines.flatMap((line) => line.segments);
  if (segments.length < 8) return null;
  const minX = Math.min(...segments.map((s) => s.x));
  const maxX = Math.max(...segments.map((s) => s.end));
  const width = maxX - minX;
  if (width <= 0) return null;
  const BIN = 2;
  const bins = Math.ceil(width / BIN) + 1;
  const cover = new Array<number>(bins).fill(0);
  for (const segment of segments) {
    const from = Math.floor((segment.x - minX) / BIN);
    const to = Math.ceil((segment.end - minX) / BIN);
    for (let at = Math.max(0, from); at < Math.min(bins, to); at += 1) {
      cover[at] = (cover[at] ?? 0) + 1;
    }
  }
  // A title or a footer may cross the gutter; a body of text may not.
  const allowed = Math.max(1, Math.floor(lines.length * 0.1));
  const low = Math.floor((width * 0.25) / BIN);
  const high = Math.ceil((width * 0.75) / BIN);
  let best: { from: number; to: number } | null = null;
  let runStart: number | null = null;
  for (let at = low; at <= high + 1; at += 1) {
    const open = at <= high && (cover[at] ?? 0) <= allowed;
    if (open && runStart === null) runStart = at;
    if (!open && runStart !== null) {
      if (best === null || at - runStart > best.to - best.from) {
        best = { from: runStart, to: at };
      }
      runStart = null;
    }
  }
  if (best === null || (best.to - best.from) * BIN < 8) return null;
  const gutter = minX + ((best.from + best.to) / 2) * BIN;
  const left = segments.filter((s) => s.end <= gutter);
  const right = segments.filter((s) => s.x >= gutter);
  if (left.length < 4 || right.length < 4) return null;
  const words = (side: readonly Segment[]) =>
    side.reduce((n, s) => n + s.text.split(" ").length, 0) / side.length;
  return words(left) >= 3 && words(right) >= 3 ? gutter : null;
}

function render(line: Line): string {
  const segments = line.rtl ? line.segments.toReversed() : line.segments;
  return segments
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join(" | ");
}

/** A column (or the whole page) as paragraphs and headings. */
function blocksOf(lines: readonly Line[], bodySize: number): PageBlock[] {
  const spacings: number[] = [];
  for (let at = 1; at < lines.length; at += 1) {
    const above = lines[at - 1];
    const here = lines[at];
    // Body lines only: the space under a heading is not line spacing.
    if (
      above !== undefined &&
      here !== undefined &&
      above.size < bodySize * 1.3 &&
      here.size < bodySize * 1.3
    ) {
      spacings.push(above.y - here.y);
    }
  }
  // The tighter end of the spacings is the usual line pitch; a paragraph
  // gap is the exception, so the median would mistake it for the rule.
  const positive = spacings.filter((s) => s > 0).toSorted((a, b) => a - b);
  const usual = positive[Math.floor(positive.length / 4)] ?? bodySize * 1.2;
  const blocks: PageBlock[] = [];
  let paragraph: string[] = [];
  let paragraphSize = 0;
  const flush = (): void => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  let previous: Line | undefined;
  for (const line of lines) {
    const text = render(line);
    if (text.length === 0) continue;
    const heading =
      line.size >= bodySize * 1.3 &&
      text.length <= 120 &&
      line.segments.length === 1;
    if (heading) {
      flush();
      const last = blocks[blocks.length - 1];
      // A heading wrapped over two lines is still one heading.
      if (
        last?.kind === "heading" &&
        previous !== undefined &&
        Math.abs(previous.size - line.size) < 0.5 &&
        previous.y - line.y <= line.size * 1.6
      ) {
        blocks[blocks.length - 1] = {
          kind: "heading",
          text: `${last.text} ${text}`,
        };
      } else {
        blocks.push({ kind: "heading", text });
      }
      previous = line;
      continue;
    }
    const gap = previous === undefined ? 0 : previous.y - line.y;
    const sizeChanged =
      paragraph.length > 0 &&
      Math.abs(line.size - paragraphSize) > Math.max(1, paragraphSize * 0.2);
    const tableRow = line.segments.length > 1;
    if (
      paragraph.length > 0 &&
      (gap > usual * 1.6 || sizeChanged || tableRow)
    ) {
      flush();
    }
    if (paragraph.length === 0) paragraphSize = line.size;
    paragraph.push(text);
    // A table row stands alone: one row per paragraph keeps its cells.
    if (tableRow) flush();
    previous = line;
  }
  flush();
  return blocks;
}

/** One page's text in reading order, as headings and paragraphs. */
export function pageBlocks(
  items: readonly PdfTextItem[],
): readonly PageBlock[] {
  const lines = linesOf(runsOf(items));
  if (lines.length === 0) return [];
  const bodySize = median(lines.map((l) => l.size));
  const gutter = gutterOf(lines);
  if (gutter === null) return blocksOf(lines, bodySize);

  // Column reading: everything left of the gutter top to bottom, then
  // everything right of it (reversed for a right-to-left page).
  const leftLines: Line[] = [];
  const rightLines: Line[] = [];
  const spanning: Line[] = [];
  for (const line of lines) {
    const left = line.segments.filter((s) => s.end <= gutter);
    const right = line.segments.filter((s) => s.x >= gutter);
    if (left.length + right.length < line.segments.length) {
      spanning.push(line);
      continue;
    }
    if (left.length > 0) leftLines.push({ ...line, segments: left });
    if (right.length > 0) rightLines.push({ ...line, segments: right });
  }
  const rtlPage = lines.filter((l) => l.rtl).length * 2 > lines.length;
  const columns = rtlPage ? [rightLines, leftLines] : [leftLines, rightLines];
  // A title spanning both columns above them is read first.
  const top = Math.max(...[...leftLines, ...rightLines].map((l) => l.y));
  const above = spanning.filter((l) => l.y > top);
  const below = spanning.filter((l) => l.y <= top);
  return [
    ...blocksOf(above, bodySize),
    ...columns.flatMap((column) => blocksOf(column, bodySize)),
    ...blocksOf(below, bodySize),
  ];
}

/** How many non-space characters a page's items hold. */
export function pageTextCharacters(items: readonly PdfTextItem[]): number {
  let count = 0;
  for (const item of items) {
    if (typeof item.str === "string")
      count += item.str.replace(/\s/g, "").length;
  }
  return count;
}
