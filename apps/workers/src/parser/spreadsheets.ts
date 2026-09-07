import type {
  ExtractedBlock,
  ParserOutput,
} from "@capital-q/evidence/contracts";

import {
  BlockBuilder,
  normaliseWhitespace,
  type ContentExtractor,
  type ExtractionContext,
} from "./extractors.js";
import {
  findAll,
  localName,
  openOoxmlPackage,
  OoxmlRefusedError,
  parseXml,
  type XmlNode,
} from "./ooxml.js";

/**
 * Spreadsheet extractors (CQ-RAG-001 §18-§19; doc 14 §11.2).
 *
 * A workbook is not prose. What comes out of here is a set of bounded
 * range blocks — sheet, A1 range, rows of cell text — so a later chunk can
 * say "Revenue sheet, B4:D6" and keep the row and column labels beside the
 * values. Nothing is evaluated: a cell's cached value is read as text, a
 * formula is never executed, and a macro-enabled package has no extractor at
 * all. No financial meaning is attached; that is a claim, not an extraction.
 */

const SPREADSHEET_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const XLSX_EXTRACTOR_VERSION = "1.0.0";
export const CSV_EXTRACTOR_VERSION = "1.0.0";

type Cell = { readonly column: number; readonly value: string };
type Row = { readonly number: number; readonly cells: readonly Cell[] };

/** `AB` → 28. Bounded by the caller's column limit. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index;
}

/** 28 → `AB`. */
export function columnLetters(index: number): string {
  let value = index;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

const CELL_REFERENCE = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;

function attribute(node: XmlNode, ...names: readonly string[]): string | null {
  for (const name of names) {
    const value = node.attributes.get(name);
    if (value !== undefined) return value;
  }
  for (const [key, value] of node.attributes) {
    if (names.some((name) => key.endsWith(`:${name}`))) return value;
  }
  return null;
}

function joinedText(node: XmlNode): string {
  return findAll(node, "t")
    .map((text) => text.text)
    .join("");
}

/** Shared strings, in order. Rich-text runs are concatenated. */
function readSharedStrings(xml: string | null, context: ExtractionContext) {
  if (xml === null) return [];
  const parsed = parseXml(xml, {
    maxNodes: context.limits.maxXmlNodes,
    maxDepth: context.limits.maxXmlDepth,
  });
  return findAll(parsed, "si").map((item) => joinedText(item));
}

type SheetRef = { readonly name: string; readonly path: string };

function readSheetRefs(
  workbookXml: string,
  relsXml: string | null,
  context: ExtractionContext,
): readonly SheetRef[] {
  const options = {
    maxNodes: context.limits.maxXmlNodes,
    maxDepth: context.limits.maxXmlDepth,
  };
  const targets = new Map<string, string>();
  if (relsXml !== null) {
    for (const relationship of findAll(
      parseXml(relsXml, options),
      "Relationship",
    )) {
      const id = attribute(relationship, "Id");
      const target = attribute(relationship, "Target");
      if (id === null || target === null) continue;
      // Targets are package-relative to xl/, occasionally absolute. Anything
      // that tries to leave the package is simply not a sheet.
      const normalised = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target}`;
      if (normalised.includes("..")) continue;
      targets.set(id, normalised);
    }
  }
  const sheets: SheetRef[] = [];
  for (const sheet of findAll(parseXml(workbookXml, options), "sheet")) {
    const name =
      attribute(sheet, "name") ?? `Sheet${String(sheets.length + 1)}`;
    const relationshipId = attribute(sheet, "id");
    const path =
      relationshipId === null ? undefined : targets.get(relationshipId);
    if (path === undefined) continue;
    sheets.push({ name: normaliseWhitespace(name).slice(0, 255), path });
  }
  return sheets;
}

function cellValue(cell: XmlNode, sharedStrings: readonly string[]): string {
  const type = attribute(cell, "t") ?? "n";
  if (type === "inlineStr") {
    return joinedText(cell);
  }
  const value = cell.children.find((child) => localName(child) === "v");
  const raw = value === undefined ? "" : value.text;
  switch (type) {
    case "s": {
      const index = Number(raw);
      return Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
    }
    case "b":
      return raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
    case "e":
      // An error cell is reported as its error text, never interpreted.
      return raw;
    default:
      // Numbers, dates (as serials) and formula string results: the cached
      // value as the file stores it. Nothing is recomputed.
      return raw;
  }
}

function readRows(
  sheetXml: string,
  sharedStrings: readonly string[],
  context: ExtractionContext,
  budget: { cells: number },
): { readonly rows: readonly Row[]; readonly truncated: boolean } {
  const parsed = parseXml(sheetXml, {
    maxNodes: context.limits.maxXmlNodes,
    maxDepth: context.limits.maxXmlDepth,
  });
  const rows: Row[] = [];
  let truncated = false;
  let fallbackRow = 0;
  for (const rowNode of findAll(parsed, "row")) {
    if (rows.length >= context.limits.maxRowsPerSheet) {
      truncated = true;
      break;
    }
    fallbackRow += 1;
    const declared = Number(attribute(rowNode, "r"));
    const number =
      Number.isInteger(declared) && declared >= 1 ? declared : fallbackRow;
    fallbackRow = number;
    const cells: Cell[] = [];
    let fallbackColumn = 0;
    for (const cellNode of rowNode.children) {
      if (localName(cellNode) !== "c") continue;
      fallbackColumn += 1;
      const reference = attribute(cellNode, "r");
      const match = reference === null ? null : CELL_REFERENCE.exec(reference);
      const column =
        match === null ? fallbackColumn : columnIndex(match[1] ?? "A");
      fallbackColumn = column;
      if (column > context.limits.maxColumnsPerSheet) {
        truncated = true;
        continue;
      }
      if (budget.cells >= context.limits.maxCellsTotal) {
        truncated = true;
        break;
      }
      budget.cells += 1;
      const value = normaliseWhitespace(cellValue(cellNode, sharedStrings));
      if (value.length === 0) continue;
      cells.push({ column, value });
    }
    if (cells.length > 0) rows.push({ number, cells });
  }
  return { rows, truncated };
}

/**
 * Emits one `spreadsheet_range` block per window of rows. The grid is dense
 * across the sheet's used columns so every row keeps the same column
 * positions; the range names exactly what the window covers.
 */
function emitRanges(
  builder: BlockBuilder,
  rows: readonly Row[],
  sheet: string | undefined,
  context: ExtractionContext,
): void {
  if (rows.length === 0) return;
  const minColumn = Math.min(...rows.map((row) => row.cells[0]?.column ?? 1));
  const maxColumn = Math.max(
    ...rows.map((row) => row.cells[row.cells.length - 1]?.column ?? 1),
  );
  const width = maxColumn - minColumn + 1;
  const windowRows = Math.min(
    context.limits.maxRangeRows,
    // The artifact contract's own bound; never exceeded whatever the limits say.
    200,
  );
  for (let start = 0; start < rows.length; start += windowRows) {
    const window = rows.slice(start, start + windowRows);
    const first = window[0];
    const last = window[window.length - 1];
    if (first === undefined || last === undefined) break;
    const grid = window.map((row) => {
      const line = Array.from({ length: width }, () => "");
      for (const cell of row.cells) {
        line[cell.column - minColumn] = builder.clip(cell.value);
      }
      return line;
    });
    const characters = grid.reduce(
      (total, line) => total + line.reduce((sum, cell) => sum + cell.length, 0),
      sheet?.length ?? 0,
    );
    const range = `${columnLetters(minColumn)}${String(first.number)}:${columnLetters(maxColumn)}${String(last.number)}`;
    const block: ExtractedBlock = {
      kind: "spreadsheet_range",
      ...(sheet === undefined ? {} : { sheet }),
      range,
      rows: grid,
      locator: {
        index: builder.index,
        ...(sheet === undefined ? {} : { sheet }),
        range,
        rowStart: first.number,
        rowEnd: last.number,
      },
    };
    if (!builder.add(block, characters)) return;
  }
}

export function createXlsxExtractor(): ContentExtractor {
  return {
    id: "ooxml_xlsx",
    version: XLSX_EXTRACTOR_VERSION,
    supports: (descriptor) => descriptor.mimeType === SPREADSHEET_MIME,
    extract: (input, context) => {
      const pkg = openOoxmlPackage(input, context.limits);
      const workbook = pkg.read("xl/workbook.xml");
      if (workbook === null) {
        throw new OoxmlRefusedError("MALFORMED_PACKAGE", "no xl/workbook.xml");
      }
      // A VBA project means a macro-enabled package mislabelled as .xlsx.
      // Nothing here would run it, but the mismatch itself is a refusal.
      if (pkg.names.some((name) => /^xl\/vbaProject\.bin$/i.test(name))) {
        throw new OoxmlRefusedError(
          "ARCHIVE_UNSAFE_ENTRY",
          "macro project in a spreadsheet package",
        );
      }
      const sharedStrings = readSharedStrings(
        pkg.read("xl/sharedStrings.xml"),
        context,
      );
      const refs = readSheetRefs(
        workbook,
        pkg.read("xl/_rels/workbook.xml.rels"),
        context,
      );
      const builder = new BlockBuilder(context.limits);
      const budget = { cells: 0 };
      let truncated = refs.length > context.limits.maxSheets;
      for (const ref of refs.slice(0, context.limits.maxSheets)) {
        const xml = pkg.read(ref.path);
        if (xml === null) continue;
        const read = readRows(xml, sharedStrings, context, budget);
        truncated = truncated || read.truncated;
        emitRanges(builder, read.rows, ref.name, context);
        if (builder.truncated) break;
      }
      const output: ParserOutput = {
        blocks: [...builder.build()],
        metadata: {
          parser: "ooxml_xlsx",
          parserVersion: XLSX_EXTRACTOR_VERSION,
          ...(truncated || builder.truncated ? { truncated: true } : {}),
        },
      };
      return Promise.resolve(output);
    },
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 records: comma-separated, double-quote escaped, CRLF or LF. */
export function parseCsv(
  text: string,
  limits: { readonly maxRecords: number; readonly maxFields: number },
): {
  readonly records: readonly (readonly string[])[];
  readonly truncated: boolean;
} {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;

  const endField = (): void => {
    if (fields.length < limits.maxFields) fields.push(field);
    else truncated = true;
    field = "";
  };
  const endRecord = (): boolean => {
    endField();
    if (fields.some((value) => value.length > 0)) {
      if (records.length >= limits.maxRecords) {
        truncated = true;
        fields = [];
        return false;
      }
      records.push(fields);
    }
    fields = [];
    return true;
  };

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at += 1;
      if (!endRecord()) break;
    } else {
      field += char;
    }
  }
  if (field.length > 0 || fields.length > 0) endRecord();
  return { records, truncated };
}

export function createCsvExtractor(): ContentExtractor {
  return {
    id: "csv",
    version: CSV_EXTRACTOR_VERSION,
    supports: (descriptor) => descriptor.mimeType === "text/csv",
    extract: (input, context) => {
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(input);
      const decoded = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const parsed = parseCsv(decoded, {
        maxRecords: context.limits.maxRowsPerSheet,
        maxFields: context.limits.maxColumnsPerSheet,
      });
      const rows: Row[] = parsed.records.map((record, offset) => ({
        number: offset + 1,
        cells: record
          .map((value, column) => ({
            column: column + 1,
            value: normaliseWhitespace(value),
          }))
          .filter((cell) => cell.value.length > 0),
      }));
      const builder = new BlockBuilder(context.limits);
      emitRanges(
        builder,
        rows.filter((row) => row.cells.length > 0),
        undefined,
        context,
      );
      const output: ParserOutput = {
        blocks: [...builder.build()],
        metadata: {
          parser: "csv",
          parserVersion: CSV_EXTRACTOR_VERSION,
          ...(parsed.truncated || builder.truncated ? { truncated: true } : {}),
        },
      };
      return Promise.resolve(output);
    },
  };
}
