import type { ExtractedBlock } from "@capital-q/evidence/contracts";
import { scanInstructionRisk } from "@capital-q/evidence";

import {
  CHUNK_LIMITS,
  CHUNKING_VERSION,
  ChunkPlanSchema,
  type ChunkKind,
  type ChunkLocator,
  type ChunkPlan,
  type ChunkingStrategy,
  type PlannedChunk,
} from "../contracts/index.js";
import {
  contentHash,
  estimateTokens,
  packSentences,
  trailingSentences,
} from "./text.js";

export {
  CHARACTERS_PER_TOKEN,
  contentHash,
  estimateTokens,
  packSentences,
  splitSentences,
} from "./text.js";

/**
 * Structure-aware chunking (CQ-RAG-001 §20-§27; doc 14 §11-§14).
 *
 * Three strategies, chosen by what the extractor found, never one splitter
 * for everything:
 *
 *   slide        one chunk per slide; a very long slide becomes a parent
 *                with sentence-packed children.
 *   narrative    heading-aware sections. A section that fits is one leaf;
 *                a long section becomes parent windows of coherent blocks
 *                with sentence-packed children under each. Tables and lists
 *                are never split unless a single one exceeds the leaf bound.
 *   spreadsheet  one chunk per range window, rendered with the sheet, the
 *                range and the row and column labels beside every value.
 *
 * Deterministic: the same blocks under the same version yield the same
 * chunks, the same order and the same hashes. No model is consulted, no
 * meaning is inferred, and document text that looks like an instruction is
 * carried as text.
 */

type Unit = {
  readonly kind: ChunkKind;
  readonly text: string;
  readonly tokens: number;
  readonly blockIndex: number;
  readonly block: ExtractedBlock;
};

type Section = {
  readonly headingPath: readonly string[];
  readonly headingText: string | null;
  readonly headingBlock: ExtractedBlock | null;
  readonly units: readonly Unit[];
};

const clip = (text: string, max: number = CHUNK_LIMITS.maxContentCharacters) =>
  text.length > max ? text.slice(0, max) : text;

function renderTableRows(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join(" | ")).join("\n");
}

function renderList(items: readonly string[], ordered: boolean): string {
  return items
    .map((item, at) => (ordered ? `${String(at + 1)}. ${item}` : `- ${item}`))
    .join("\n");
}

/** Column letters for a 1-based index, mirroring the extractor. */
function columnLetters(index: number): string {
  let value = index;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

const NUMERIC = /^[-+]?(?:\d+[\d,]*(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?%?$/i;

function looksNumeric(value: string): boolean {
  return NUMERIC.test(value.trim());
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

function locatorFor(
  blocks: readonly ExtractedBlock[],
  headingPath: readonly string[],
): ChunkLocator {
  const pages = blocks
    .map((b) => b.locator.page)
    .filter((p): p is number => p !== undefined);
  const sections = blocks
    .map((b) => b.locator.section)
    .filter((s): s is number => s !== undefined);
  const lineStarts = blocks
    .map((b) => b.locator.lineStart)
    .filter((l): l is number => l !== undefined);
  const lineEnds = blocks
    .map((b) => b.locator.lineEnd)
    .filter((l): l is number => l !== undefined);
  const locator: ChunkLocator = {
    ...(pages.length === 0
      ? {}
      : { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) }),
    ...(headingPath.length === 0
      ? {}
      : {
          headingPath: headingPath
            .slice(0, CHUNK_LIMITS.maxHeadingPath)
            .map((h) => clip(h, CHUNK_LIMITS.maxHeadingCharacters)),
        }),
    ...(sections.length === 0
      ? {}
      : {
          sectionStart: Math.min(...sections),
          sectionEnd: Math.max(...sections),
        }),
    ...(lineStarts.length === 0 ? {} : { lineStart: Math.min(...lineStarts) }),
    ...(lineEnds.length === 0 ? {} : { lineEnd: Math.max(...lineEnds) }),
  };
  return locator;
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

class PlanBuilder {
  readonly chunks: PlannedChunk[] = [];
  truncated = false;

  add(input: {
    readonly role: PlannedChunk["role"];
    readonly parentIndex: number | null;
    readonly kind: ChunkKind;
    readonly content: string;
    readonly blocks: readonly ExtractedBlock[];
    /** Blocks that define the chunk's index range; defaults to `blocks`. */
    readonly rangeBlocks?: readonly ExtractedBlock[] | undefined;
    readonly locator: ChunkLocator;
  }): number | null {
    if (this.chunks.length >= CHUNK_LIMITS.maxChunksPerSet) {
      this.truncated = true;
      return null;
    }
    const content = clip(input.content.trim());
    if (content.length === 0) return null;
    const indices = (input.rangeBlocks ?? input.blocks).map(
      (b) => b.locator.index,
    );
    const index = this.chunks.length;
    this.chunks.push({
      index,
      role: input.role,
      parentIndex: input.parentIndex,
      kind: input.kind,
      content,
      contentSha256: contentHash(content),
      tokenEstimate: estimateTokens(content),
      blockIndexStart: Math.min(...indices),
      blockIndexEnd: Math.max(...indices),
      locator: input.locator,
      instructionRiskSignals: scanInstructionRisk(input.blocks).signals.length,
    });
    return index;
  }
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

function unitsOf(block: ExtractedBlock): readonly Unit[] {
  const make = (kind: ChunkKind, text: string): Unit => ({
    kind,
    text,
    tokens: estimateTokens(text),
    blockIndex: block.locator.index,
    block,
  });
  switch (block.kind) {
    case "paragraph":
    case "footnote": {
      if (estimateTokens(block.text) <= CHUNK_LIMITS.maxLeafTokens) {
        return [make("passage", block.text)];
      }
      // One paragraph past the leaf bound is cut at sentences, never mid-word.
      return packSentences(block.text, CHUNK_LIMITS.targetLeafTokens).map(
        (piece) => make("passage", piece),
      );
    }
    case "list": {
      const whole = renderList(block.items, block.ordered);
      if (estimateTokens(whole) <= CHUNK_LIMITS.maxLeafTokens) {
        return [make("list", whole)];
      }
      const units: Unit[] = [];
      let group: string[] = [];
      let offset = 0;
      const flush = (): void => {
        if (group.length === 0) return;
        const text = group
          .map((item, at) =>
            block.ordered ? `${String(offset + at + 1)}. ${item}` : `- ${item}`,
          )
          .join("\n");
        units.push(make("list", text));
        offset += group.length;
        group = [];
      };
      for (const item of block.items) {
        const candidate = [...group, item].join("\n");
        if (
          group.length > 0 &&
          estimateTokens(candidate) > CHUNK_LIMITS.targetLeafTokens
        ) {
          flush();
        }
        group.push(item);
      }
      flush();
      return units;
    }
    case "table": {
      const whole = renderTableRows(block.rows);
      if (estimateTokens(whole) <= CHUNK_LIMITS.maxLeafTokens) {
        return [make("table", whole)];
      }
      // A long table is cut by rows with its first row repeated, so every
      // piece still carries the column labels.
      const header = block.rows[0];
      const body = block.rows.slice(1);
      const units: Unit[] = [];
      let rows: (readonly string[])[] = [];
      const flush = (): void => {
        if (rows.length === 0) return;
        units.push(
          make(
            "table",
            renderTableRows(header === undefined ? rows : [header, ...rows]),
          ),
        );
        rows = [];
      };
      for (const row of body) {
        const candidate = renderTableRows(
          header === undefined ? [...rows, row] : [header, ...rows, row],
        );
        if (
          rows.length > 0 &&
          estimateTokens(candidate) > CHUNK_LIMITS.targetLeafTokens
        ) {
          flush();
        }
        rows.push(row);
      }
      flush();
      return units;
    }
    case "heading":
    case "slide":
    case "spreadsheet_range":
    case "page_break":
      return [];
  }
}

function sectionsOf(blocks: readonly ExtractedBlock[]): readonly Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  let current: {
    headingPath: string[];
    headingText: string | null;
    headingBlock: ExtractedBlock | null;
    units: Unit[];
  } = { headingPath: [], headingText: null, headingBlock: null, units: [] };
  const close = (): void => {
    if (current.units.length > 0 || current.headingText !== null) {
      sections.push({ ...current, units: [...current.units] });
    }
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      close();
      path.length = Math.min(path.length, block.level - 1);
      while (path.length < block.level - 1) path.push("");
      path.push(block.text);
      current = {
        headingPath: path.filter((h) => h.length > 0),
        headingText: block.text,
        headingBlock: block,
        units: [],
      };
      continue;
    }
    if (block.kind === "page_break") continue;
    current.units.push(...unitsOf(block));
  }
  close();
  return sections;
}

function kindOf(units: readonly Unit[]): ChunkKind {
  const kinds = new Set(units.map((u) => u.kind));
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only === "table" || only === "list") return only;
  }
  return "passage";
}

function planNarrative(
  blocks: readonly ExtractedBlock[],
  builder: PlanBuilder,
): void {
  for (const section of sectionsOf(blocks)) {
    const headingLine = section.headingText ?? "";
    const headingTokens = estimateTokens(headingLine);
    const total =
      headingTokens + section.units.reduce((n, u) => n + u.tokens, 0);
    const allBlocks = [
      ...(section.headingBlock === null ? [] : [section.headingBlock]),
      ...section.units.map((u) => u.block),
    ];
    if (section.units.length === 0) {
      // A heading with nothing under it is still a place a citation can
      // name; it becomes a tiny leaf rather than vanishing.
      builder.add({
        role: "LEAF",
        parentIndex: null,
        kind: "section",
        content: headingLine,
        blocks: allBlocks,
        locator: locatorFor(allBlocks, section.headingPath),
      });
      continue;
    }
    const render = (units: readonly Unit[], withHeading: boolean): string =>
      [
        ...(withHeading && headingLine.length > 0 ? [headingLine] : []),
        ...units.map((u) => u.text),
      ].join("\n\n");

    if (total <= CHUNK_LIMITS.maxLeafTokens) {
      builder.add({
        role: "LEAF",
        parentIndex: null,
        kind: "section",
        content: render(section.units, true),
        blocks: allBlocks,
        locator: locatorFor(allBlocks, section.headingPath),
      });
      continue;
    }

    // Parent windows of coherent units, children packed under each. Every
    // window repeats the heading line so a parent reads as its section, but
    // only the first window's index range includes the heading block, so
    // chunk order follows the document.
    let window: Unit[] = [];
    let windowTokens = headingTokens;
    let firstWindow = true;
    const flushWindow = (): void => {
      if (window.length === 0) return;
      const headingBlocks =
        section.headingBlock === null || !firstWindow
          ? []
          : [section.headingBlock];
      const windowBlocks = [
        ...(section.headingBlock === null ? [] : [section.headingBlock]),
        ...window.map((u) => u.block),
      ];
      const parentIndex = builder.add({
        role: "PARENT",
        parentIndex: null,
        kind: "section",
        content: render(window, true),
        blocks: windowBlocks,
        rangeBlocks: [...headingBlocks, ...window.map((u) => u.block)],
        locator: locatorFor(windowBlocks, section.headingPath),
      });
      const windowWasFirst = firstWindow;
      firstWindow = false;
      if (parentIndex === null) {
        window = [];
        return;
      }
      let child: Unit[] = [];
      let childTokens = 0;
      let previousProse: string | null = null;
      let first = true;
      const flushChild = (): void => {
        if (child.length === 0) return;
        const kind = kindOf(child);
        const overlap =
          kind === "passage" && previousProse !== null && !first
            ? trailingSentences(
                previousProse,
                Math.floor(
                  CHUNK_LIMITS.targetLeafTokens * CHUNK_LIMITS.overlapRatio,
                ),
              )
            : "";
        const body = render(child, first);
        const content = overlap.length > 0 ? `${overlap}\n\n${body}` : body;
        const childBlocks = [
          ...(first && section.headingBlock !== null
            ? [section.headingBlock]
            : []),
          ...child.map((u) => u.block),
        ];
        builder.add({
          role: "LEAF",
          parentIndex,
          kind,
          content,
          blocks: childBlocks,
          rangeBlocks: [
            ...(first && windowWasFirst && section.headingBlock !== null
              ? [section.headingBlock]
              : []),
            ...child.map((u) => u.block),
          ],
          locator: locatorFor(childBlocks, section.headingPath),
        });
        previousProse = kind === "passage" ? body : null;
        first = false;
        child = [];
        childTokens = 0;
      };
      for (const unit of window) {
        if (
          child.length > 0 &&
          childTokens + unit.tokens > CHUNK_LIMITS.targetLeafTokens
        ) {
          flushChild();
        }
        child.push(unit);
        childTokens += unit.tokens;
      }
      flushChild();
      window = [];
      windowTokens = headingTokens;
    };
    for (const unit of section.units) {
      if (
        window.length > 0 &&
        windowTokens + unit.tokens > CHUNK_LIMITS.maxParentTokens
      ) {
        flushWindow();
      }
      window.push(unit);
      windowTokens += unit.tokens;
    }
    flushWindow();
  }
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function planSlides(
  blocks: readonly ExtractedBlock[],
  builder: PlanBuilder,
): void {
  for (const block of blocks) {
    if (block.kind !== "slide") continue;
    const locator: ChunkLocator = {
      slide: block.slideNumber,
      ...(block.title === undefined
        ? {}
        : { slideTitle: clip(block.title, 500) }),
    };
    if (estimateTokens(block.text) <= CHUNK_LIMITS.maxParentTokens) {
      builder.add({
        role: "LEAF",
        parentIndex: null,
        kind: "slide",
        content: block.text,
        blocks: [block],
        locator,
      });
      continue;
    }
    // A slide this long is a document in disguise: keep it whole as the
    // parent and search its passages.
    const parentIndex = builder.add({
      role: "PARENT",
      parentIndex: null,
      kind: "slide",
      content: block.text,
      blocks: [block],
      locator,
    });
    if (parentIndex === null) continue;
    for (const piece of packSentences(
      block.text,
      CHUNK_LIMITS.targetLeafTokens,
    )) {
      builder.add({
        role: "LEAF",
        parentIndex,
        kind: "passage",
        content: piece,
        blocks: [block],
        locator,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Spreadsheets
// ---------------------------------------------------------------------------

type SheetLabels = { readonly columns: readonly string[] | null };

/**
 * The first row of a sheet's first window is taken as column labels when
 * most of its filled cells are text. A structural reading of a header row,
 * not a financial interpretation: the values are rendered as they are.
 */
function columnLabelsFor(
  block: Extract<ExtractedBlock, { kind: "spreadsheet_range" }>,
  known: SheetLabels | undefined,
): SheetLabels {
  if (known !== undefined) return known;
  const first = block.rows[0];
  if (first === undefined) return { columns: null };
  const filled = first.filter((cell) => cell.length > 0);
  const textual = filled.filter((cell) => !looksNumeric(cell));
  const leadingLabel =
    first[0] !== undefined && first[0].length > 0 && !looksNumeric(first[0]);
  // A labelled first row at the top of the sheet ("Metric | 2025 | 2026")
  // or a mostly-textual first row anywhere is read as column labels.
  const isHeader =
    filled.length >= 2 &&
    ((block.locator.rowStart === 1 && leadingLabel) ||
      textual.length * 2 >= filled.length);
  return { columns: isHeader ? first : null };
}

function renderRange(
  block: Extract<ExtractedBlock, { kind: "spreadsheet_range" }>,
  rows: readonly (readonly string[])[],
  firstRowOffset: number,
  labels: SheetLabels,
  firstColumn: number,
): string {
  const lines: string[] = [];
  if (block.sheet !== undefined) lines.push(`Sheet: ${block.sheet}`);
  if (block.range !== undefined) lines.push(`Range: ${block.range}`);
  const dense =
    block.locator.rowStart !== undefined &&
    block.locator.rowEnd !== undefined &&
    block.locator.rowEnd - block.locator.rowStart + 1 === block.rows.length;
  const columnName = (at: number): string =>
    labels.columns?.[at] !== undefined && labels.columns[at].length > 0
      ? labels.columns[at]
      : columnLetters(firstColumn + at);
  if (labels.columns !== null) {
    lines.push(`Columns: ${labels.columns.join(" | ")}`);
  }
  rows.forEach((row, offset) => {
    const position = firstRowOffset + offset;
    const rowNumber =
      dense && block.locator.rowStart !== undefined
        ? String(block.locator.rowStart + position)
        : `#${String(position + 1)}`;
    const label =
      row[0] !== undefined && row[0].length > 0 && !looksNumeric(row[0])
        ? ` "${row[0]}"`
        : "";
    const cells = row
      .map((value, at) => ({ value, at }))
      .filter(
        ({ value, at }) => value.length > 0 && !(label.length > 0 && at === 0),
      )
      .map(({ value, at }) => `${columnName(at)} = ${value}`);
    lines.push(`Row ${rowNumber}${label}: ${cells.join("; ")}`);
  });
  return lines.join("\n");
}

function planSpreadsheet(
  blocks: readonly ExtractedBlock[],
  builder: PlanBuilder,
): void {
  const labelsBySheet = new Map<string, SheetLabels>();
  for (const block of blocks) {
    if (block.kind !== "spreadsheet_range") continue;
    const sheetKey = block.sheet ?? "";
    const labels = columnLabelsFor(block, labelsBySheet.get(sheetKey));
    labelsBySheet.set(sheetKey, labels);
    const firstColumn =
      block.range === undefined
        ? 1
        : (() => {
            const letters = /^([A-Z]+)/.exec(block.range)?.[1] ?? "A";
            let index = 0;
            for (const char of letters)
              index = index * 26 + (char.charCodeAt(0) - 64);
            return index;
          })();
    const dataRows =
      labels.columns !== null && block.rows[0] === labels.columns
        ? block.rows.slice(1)
        : block.rows;
    const dataOffset = block.rows.length - dataRows.length;
    const locator: ChunkLocator = {
      ...(block.sheet === undefined ? {} : { sheet: block.sheet }),
      ...(block.range === undefined ? {} : { range: block.range }),
      ...(block.locator.rowStart === undefined
        ? {}
        : { rowStart: block.locator.rowStart }),
      ...(block.locator.rowEnd === undefined
        ? {}
        : { rowEnd: block.locator.rowEnd }),
    };
    const whole = renderRange(block, dataRows, dataOffset, labels, firstColumn);
    if (estimateTokens(whole) <= CHUNK_LIMITS.maxParentTokens) {
      builder.add({
        role: "LEAF",
        parentIndex: null,
        kind: "spreadsheet_range",
        content: whole,
        blocks: [block],
        locator,
      });
      continue;
    }
    // Too many rows for one chunk: cut by rows, labels repeated, flat.
    let group: (readonly string[])[] = [];
    let groupStart = 0;
    const flush = (): void => {
      if (group.length === 0) return;
      builder.add({
        role: "LEAF",
        parentIndex: null,
        kind: "spreadsheet_range",
        content: renderRange(
          block,
          group,
          dataOffset + groupStart,
          labels,
          firstColumn,
        ),
        blocks: [block],
        locator,
      });
      groupStart += group.length;
      group = [];
    };
    dataRows.forEach((row) => {
      const candidate = renderRange(
        block,
        [...group, row],
        dataOffset + groupStart,
        labels,
        firstColumn,
      );
      if (
        group.length > 0 &&
        estimateTokens(candidate) > CHUNK_LIMITS.targetLeafTokens
      ) {
        flush();
      }
      group.push(row);
    });
    flush();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function selectStrategy(
  blocks: readonly ExtractedBlock[],
): ChunkingStrategy {
  const kinds = new Set(blocks.map((b) => b.kind));
  const hasSlides = kinds.has("slide");
  const hasSheets = kinds.has("spreadsheet_range");
  const hasProse = [...kinds].some(
    (k) =>
      k === "paragraph" ||
      k === "heading" ||
      k === "list" ||
      k === "table" ||
      k === "footnote",
  );
  const count = Number(hasSlides) + Number(hasSheets) + Number(hasProse);
  if (count > 1) return "mixed";
  if (hasSlides) return "slide";
  if (hasSheets) return "spreadsheet";
  return "narrative";
}

/**
 * Plans the chunks for one extraction's blocks. Pure and deterministic;
 * persisting the plan is the use case's job.
 */
export function planChunks(
  blocks: readonly ExtractedBlock[],
  options: { readonly chunkingVersion?: string | undefined } = {},
): ChunkPlan {
  const ordered = [...blocks].sort((a, b) => a.locator.index - b.locator.index);
  const strategy = selectStrategy(ordered);
  const builder = new PlanBuilder();
  // Strategies run over the whole block list in document order; each takes
  // the blocks it understands, so a mixed document is chunked per part and
  // the chunk order follows the block order within each part.
  if (strategy === "slide" || strategy === "mixed")
    planSlides(ordered, builder);
  if (strategy === "spreadsheet" || strategy === "mixed") {
    planSpreadsheet(ordered, builder);
  }
  if (strategy === "narrative" || strategy === "mixed") {
    planNarrative(ordered, builder);
  }
  const chunks =
    strategy === "mixed"
      ? reindex(
          [...builder.chunks].sort(
            (a, b) =>
              a.blockIndexStart - b.blockIndexStart || a.index - b.index,
          ),
        )
      : builder.chunks;
  return ChunkPlanSchema.parse({
    chunkingVersion: options.chunkingVersion ?? CHUNKING_VERSION,
    strategy,
    chunks,
    tokenEstimate: chunks
      .filter((c) => c.role === "LEAF")
      .reduce((n, c) => n + c.tokenEstimate, 0),
    truncated: builder.truncated,
  });
}

/** Renumbers a re-sorted plan and remaps parent references. */
function reindex(chunks: readonly PlannedChunk[]): PlannedChunk[] {
  const mapping = new Map<number, number>();
  chunks.forEach((chunk, at) => mapping.set(chunk.index, at));
  return chunks.map((chunk, at) => ({
    ...chunk,
    index: at,
    parentIndex:
      chunk.parentIndex === null
        ? null
        : (mapping.get(chunk.parentIndex) ?? null),
  }));
}
