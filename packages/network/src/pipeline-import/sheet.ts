import { inflateRawSync } from "node:zlib";

import {
  PIPELINE_IMPORT_MAX_BYTES,
  PIPELINE_IMPORT_MAX_COLUMNS,
  PIPELINE_IMPORT_MAX_ROWS,
} from "@capital-q/contracts";

/**
 * Deterministic reading of a pipeline file (decision 106). No model, no
 * network, no guessing: a CSV is read by RFC 4180 (with the delimiter a
 * spreadsheet export actually used), an XLSX by its first worksheet. The
 * file has already passed the document path's scan; the bounds here keep a
 * hostile or broken file from costing more than a normal one (a zip bomb
 * inflates to at most SHEET_XML_MAX_BYTES, never more).
 *
 * Cell values are kept as text. Excel stores dates as serial numbers; a
 * numeric cell is returned as its number text and the caller reads it as a
 * date only for a column mapped to a date.
 */

export type SheetFormat = "CSV" | "XLSX";

export type Sheet = {
  readonly format: SheetFormat;
  readonly headers: readonly string[];
  /** Data rows (no header), each as long as `headers`. Blank rows are dropped. */
  readonly rows: readonly (readonly string[])[];
};

export type SheetErrorCode =
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "EMPTY"
  | "NO_HEADER"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_COLUMNS"
  | "UNREADABLE";

export class SheetError extends Error {
  readonly code: SheetErrorCode;
  constructor(code: SheetErrorCode, message: string) {
    super(message);
    this.name = "SheetError";
    this.code = code;
  }
}

/** A cell's text, at most. Longer cells are cut (a note pasted into a cell). */
export const SHEET_CELL_MAX_CHARS = 4000;
/** One inflated XML part of an XLSX, at most. */
const SHEET_XML_MAX_BYTES = 64 * 1024 * 1024;

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function sheetFormatOf(
  mimeType: string,
  fileName: string,
): SheetFormat | null {
  const name = fileName.toLowerCase();
  if (mimeType === XLSX_MIME || name.endsWith(".xlsx")) return "XLSX";
  if (
    mimeType === "text/csv" ||
    mimeType === "text/plain" ||
    name.endsWith(".csv")
  ) {
    return "CSV";
  }
  return null;
}

export function readSheet(input: {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fileName: string;
}): Sheet {
  if (input.bytes.byteLength > PIPELINE_IMPORT_MAX_BYTES) {
    throw new SheetError(
      "TOO_LARGE",
      `The file is larger than ${String(PIPELINE_IMPORT_MAX_BYTES / (1024 * 1024))} MB.`,
    );
  }
  const format = sheetFormatOf(input.mimeType, input.fileName);
  if (format === null) {
    throw new SheetError(
      "UNSUPPORTED_TYPE",
      "Only a CSV or an Excel (.xlsx) file can be imported.",
    );
  }
  const grid =
    format === "CSV"
      ? parseCsv(decodeText(input.bytes))
      : parseXlsx(input.bytes);
  return toSheet(format, grid);
}

function toSheet(format: SheetFormat, grid: readonly string[][]): Sheet {
  const nonBlank = grid.filter((row) => row.some((cell) => cell.trim() !== ""));
  const [header, ...data] = nonBlank;
  if (header === undefined) throw new SheetError("EMPTY", "The file is empty.");
  const headers = header.map((cell) => cell.replace(/\s+/g, " ").trim());
  // Trailing unnamed columns (a sheet's stray formatting) are not columns.
  let width = headers.length;
  while (width > 0 && headers[width - 1] === "") width -= 1;
  if (width === 0 || headers.slice(0, width).every((h) => h === "")) {
    throw new SheetError(
      "NO_HEADER",
      "The first row must name the columns (for example Company, Stage, Website).",
    );
  }
  if (width > PIPELINE_IMPORT_MAX_COLUMNS) {
    throw new SheetError(
      "TOO_MANY_COLUMNS",
      `The file has more than ${String(PIPELINE_IMPORT_MAX_COLUMNS)} columns.`,
    );
  }
  if (data.length > PIPELINE_IMPORT_MAX_ROWS) {
    throw new SheetError(
      "TOO_MANY_ROWS",
      `The file has ${String(data.length)} rows; at most ${String(PIPELINE_IMPORT_MAX_ROWS)} can be imported at once. Split it and import each part.`,
    );
  }
  if (data.length === 0) {
    throw new SheetError("EMPTY", "The file has a header row but no rows.");
  }
  // Unnamed columns in the middle keep their place under a stable name.
  const named = headers
    .slice(0, width)
    .map((h, index) => (h === "" ? `Column ${String(index + 1)}` : h));
  return {
    format,
    headers: named,
    rows: data.map((row) =>
      named.map((_, index) =>
        (row[index] ?? "").trim().slice(0, SHEET_CELL_MAX_CHARS),
      ),
    ),
  };
}

function decodeText(bytes: Uint8Array): string {
  // UTF-16 exports (Excel's "Unicode text") carry a BOM.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return utf8.startsWith("﻿") ? utf8.slice(1) : utf8;
}

/** The delimiter of the header line: the most frequent of , ; and tab outside quotes. */
function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  let best = ",";
  for (const [delimiter, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      if (rows.length > PIPELINE_IMPORT_MAX_ROWS + 1) {
        throw new SheetError(
          "TOO_MANY_ROWS",
          `The file has more than ${String(PIPELINE_IMPORT_MAX_ROWS)} rows. Split it and import each part.`,
        );
      }
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) {
    throw new SheetError("UNREADABLE", "The file has an unclosed quote.");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- XLSX: a zip of XML parts --------------------------------------------

type ZipEntry = {
  readonly method: number;
  readonly compressedSize: number;
  readonly offset: number;
};

function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last 0x06054b50 within 64 KiB of the end.
  let end = -1;
  for (
    let at = bytes.byteLength - 22;
    at >= Math.max(0, bytes.byteLength - 22 - 0xffff);
    at -= 1
  ) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) {
    throw new SheetError("UNREADABLE", "The Excel file could not be read.");
  }
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== 0x02014b50) {
      throw new SheetError("UNREADABLE", "The Excel file could not be read.");
    }
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { method, compressedSize, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipText(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  name: string,
): string | null {
  const entry = entries.get(name);
  if (entry === undefined) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.offset;
  if (
    local + 30 > bytes.byteLength ||
    view.getUint32(local, true) !== 0x04034b50
  ) {
    throw new SheetError("UNREADABLE", "The Excel file could not be read.");
  }
  const start =
    local +
    30 +
    view.getUint16(local + 26, true) +
    view.getUint16(local + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let raw: Uint8Array;
  try {
    if (entry.method === 0) raw = data;
    else if (entry.method === 8) {
      raw = inflateRawSync(data, { maxOutputLength: SHEET_XML_MAX_BYTES });
    } else {
      throw new SheetError("UNREADABLE", "The Excel file could not be read.");
    }
  } catch (error: unknown) {
    if (error instanceof SheetError) throw error;
    throw new SheetError(
      "TOO_LARGE",
      "The Excel file expands to more than can be read at once.",
    );
  }
  return new TextDecoder("utf-8").decode(raw);
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function xmlText(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g,
    (whole, code: string) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return ENTITIES[code] ?? whole;
    },
  );
}

/** Every <t> inside one element, joined (rich text runs are one string). */
function textRuns(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += xmlText(match[1] ?? "");
  }
  return out;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "";
  let index = 0;
  for (const letter of letters)
    index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function firstWorksheetPath(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
): string {
  const workbook = zipText(bytes, entries, "xl/workbook.xml");
  const rels = zipText(bytes, entries, "xl/_rels/workbook.xml.rels");
  const sheetRel =
    workbook === null
      ? null
      : /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (rels !== null && sheetRel !== undefined && sheetRel !== null) {
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attributes = match[1] ?? "";
      if (attributes.includes(`Id="${sheetRel}"`)) {
        const target = /Target="([^"]+)"/.exec(attributes)?.[1];
        if (target !== undefined) {
          return target.startsWith("/")
            ? target.slice(1)
            : `xl/${target.replace(/^\.\//, "")}`;
        }
      }
    }
  }
  return "xl/worksheets/sheet1.xml";
}

export function parseXlsx(bytes: Uint8Array): string[][] {
  const entries = zipEntries(bytes);
  const shared: string[] = [];
  const sharedXml = zipText(bytes, entries, "xl/sharedStrings.xml");
  if (sharedXml !== null) {
    for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(textRuns(match[1] ?? ""));
    }
  }
  const sheetXml = zipText(bytes, entries, firstWorksheetPath(bytes, entries));
  if (sheetXml === null) {
    throw new SheetError("UNREADABLE", "The Excel file has no worksheet.");
  }
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(
    /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g,
  )) {
    if (rows.length > PIPELINE_IMPORT_MAX_ROWS + 1) {
      throw new SheetError(
        "TOO_MANY_ROWS",
        `The file has more than ${String(PIPELINE_IMPORT_MAX_ROWS)} rows. Split it and import each part.`,
      );
    }
    const row: string[] = [];
    let next = 0;
    for (const cell of (rowMatch[1] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attributes = cell[1] ?? "";
      const body = cell[2] ?? "";
      const reference = /\br="([A-Z]+[0-9]+)"/.exec(attributes)?.[1];
      const index = reference === undefined ? next : columnIndex(reference);
      if (index < 0 || index >= PIPELINE_IMPORT_MAX_COLUMNS * 4) continue;
      const type = /\bt="([a-zA-Z]+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s") text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = textRuns(body);
      else if (value !== undefined) text = xmlText(value);
      while (row.length < index) row.push("");
      row[index] = text;
      next = index + 1;
    }
    rows.push(row);
  }
  return rows;
}
