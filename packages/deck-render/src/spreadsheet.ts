import ExcelJS from "exceljs";

import {
  Q_SOURCES_SHEET_NAME,
  type QSheet,
  type QSheetCell,
  type QSheetColumn,
  type QWorkbook,
} from "@capital-q/contracts";

/**
 * A stored workbook as a file (XLSX-001).
 *
 * Draws exactly what the spec says and decides nothing about it: each
 * cell in the type its column declares, money in its own currency's
 * format, percents in points shown as %, dates as dates, a frozen header
 * row, and the spec's totals as real SUM/AVERAGE formulas over the data
 * rows. A null cell is left empty -- never a zero, never a dash -- so an
 * unknown value cannot be summed as if it were nothing. The last sheet is
 * always "Sources": where each column came from and its truth class, and
 * the provenance line under it.
 *
 * Text is written as text: a cell that happens to begin with "=" is a
 * string in the file, never a formula someone else wrote.
 */

export type SpreadsheetMeta = {
  readonly title: string;
};

const WIDTH_MIN = 10;
const WIDTH_MAX = 60;
const HEADER_FILL = "FFF1F1EE";

/** A column's display format; money takes each cell's own currency. */
function numberFormat(column: QSheetColumn, sheet: QSheet, at: number) {
  switch (column.type) {
    case "number": {
      const whole = sheet.rows.every((row) => {
        const cell = row[at];
        return typeof cell !== "string" || !cell.includes(".");
      });
      return whole ? "#,##0" : "#,##0.00";
    }
    case "percent":
      return "0.0%";
    case "date":
      return "yyyy-mm-dd";
    case "money":
    case "text":
    case "boolean":
      return undefined;
  }
}

const moneyFormat = (currency: string) => `#,##0.00 "${currency}"`;

/** The value exceljs writes for a typed cell; null stays empty. */
function cellValue(
  column: QSheetColumn,
  cell: QSheetCell,
): string | number | boolean | Date | null {
  if (cell === null) return null;
  switch (column.type) {
    case "text":
      return typeof cell === "string" ? cell : null;
    case "number":
      return typeof cell === "string" ? Number(cell) : null;
    case "percent":
      // Points in the spec ("3.8"), a fraction in the file (0.038 as 3.8%).
      return typeof cell === "string" ? Number(cell) / 100 : null;
    case "money":
      return typeof cell === "object" ? Number(cell.amount) : null;
    case "date":
      return typeof cell === "string" ? new Date(`${cell}T00:00:00Z`) : null;
    case "boolean":
      return typeof cell === "boolean" ? cell : null;
  }
}

/** How wide a cell reads, in characters, for the column's width. */
function cellWidth(column: QSheetColumn, cell: QSheetCell): number {
  if (cell === null) return 0;
  if (typeof cell === "object") return cell.amount.length + 8;
  if (typeof cell === "boolean") return 5;
  if (column.type === "text") {
    return Math.max(...cell.split("\n").map((line) => line.length));
  }
  return cell.length + 4;
}

/** Spreadsheet column letters: 1 -> A, 27 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function headerRow(worksheet: ExcelJS.Worksheet, labels: readonly string[]) {
  const row = worksheet.addRow([...labels]);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.border = { bottom: { style: "thin" } };
  });
}

/** The cached result of a total, for viewers that do not recalculate. */
function totalResult(
  values: readonly number[],
  fn: "SUM" | "AVERAGE",
): number | undefined {
  if (values.length === 0) return fn === "SUM" ? 0 : undefined;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return fn === "SUM" ? sum : sum / values.length;
}

function drawSheet(workbook: ExcelJS.Workbook, sheet: QSheet) {
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  headerRow(
    worksheet,
    sheet.columns.map((column) =>
      column.type === "money" && column.currency !== undefined
        ? `${column.label} (${column.currency})`
        : column.label,
    ),
  );
  for (const cells of sheet.rows) {
    const row = worksheet.addRow(
      sheet.columns.map((column, at) => cellValue(column, cells[at] ?? null)),
    );
    sheet.columns.forEach((column, at) => {
      const cell = cells[at] ?? null;
      const target = row.getCell(at + 1);
      if (cell === null) return;
      if (column.type === "money" && typeof cell === "object") {
        target.numFmt = moneyFormat(cell.currency);
        return;
      }
      if (column.type === "text") {
        target.alignment = { wrapText: true, vertical: "top" };
        return;
      }
      const format = numberFormat(column, sheet, at);
      if (format !== undefined) target.numFmt = format;
    });
  }
  const first = 2;
  const last = sheet.rows.length + 1;
  if (sheet.totals.length > 0 && sheet.rows.length > 0) {
    const values: (string | null)[] = sheet.columns.map(() => null);
    const labelled = sheet.totals.some(
      (total) => total.column === sheet.columns[0]?.key,
    );
    if (!labelled) {
      const fns = new Set(sheet.totals.map((total) => total.fn));
      values[0] = fns.size === 1 && fns.has("AVERAGE") ? "Average" : "Total";
    }
    const row = worksheet.addRow(values);
    row.font = { bold: true };
    for (const total of sheet.totals) {
      const at = sheet.columns.findIndex((c) => c.key === total.column);
      const column = sheet.columns[at];
      if (column === undefined) continue;
      const letter = columnLetter(at + 1);
      const known = sheet.rows.flatMap((cells) => {
        const value = cellValue(column, cells[at] ?? null);
        return typeof value === "number" ? [value] : [];
      });
      const result = totalResult(known, total.fn);
      const target = row.getCell(at + 1);
      target.value = {
        formula: `${total.fn}(${letter}${String(first)}:${letter}${String(last)})`,
        ...(result === undefined ? {} : { result }),
      };
      if (column.type === "money") {
        const currency =
          column.currency ??
          sheet.rows
            .map((cells) => cells[at])
            .find((cell) => cell !== null && typeof cell === "object")
            ?.currency;
        if (currency !== undefined) target.numFmt = moneyFormat(currency);
      } else {
        const format = numberFormat(column, sheet, at);
        if (format !== undefined) target.numFmt = format;
      }
      target.border = { top: { style: "thin" } };
    }
  }
  sheet.columns.forEach((column, at) => {
    const widest = Math.max(
      column.label.length + (column.currency === undefined ? 2 : 8),
      ...sheet.rows.map((cells) => cellWidth(column, cells[at] ?? null)),
    );
    worksheet.getColumn(at + 1).width = Math.min(
      WIDTH_MAX,
      Math.max(WIDTH_MIN, widest + 2),
    );
  });
  if (sheet.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: last, column: sheet.columns.length },
    };
  }
}

function drawSources(workbook: ExcelJS.Workbook, spec: QWorkbook) {
  const worksheet = workbook.addWorksheet(Q_SOURCES_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  headerRow(worksheet, [
    "Sheet",
    "Columns",
    "Where it came from",
    "Truth class",
    "Records",
  ]);
  for (const source of spec.sources) {
    const row = worksheet.addRow([
      source.sheet,
      source.columns.join(", "),
      source.from,
      source.truthClass ?? "Varies (see the sheet or the cited answer)",
      source.refs
        .map((ref) =>
          ref.label === undefined
            ? `${ref.kind} ${ref.id}`
            : `${ref.label} (${ref.kind} ${ref.id})`,
        )
        .join("\n"),
    ]);
    row.alignment = { wrapText: true, vertical: "top" };
  }
  worksheet.addRow([]);
  const footer = worksheet.addRow([spec.provenance]);
  footer.font = { italic: true };
  [14, 24, 48, 22, 60].forEach((width, at) => {
    worksheet.getColumn(at + 1).width = width;
  });
}

/** The workbook as .xlsx bytes. */
export async function workbookToXlsx(
  spec: QWorkbook,
  meta: SpreadsheetMeta,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Capital Q";
  workbook.title = meta.title;
  // Fixed so the same version draws the same file.
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  // A spreadsheet application recalculates the totals when it opens one.
  workbook.calcProperties = { fullCalcOnLoad: true };
  for (const sheet of spec.sheets) drawSheet(workbook, sheet);
  drawSources(workbook, spec);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/** A CSV field, quoted when needed, and never read as a formula. */
function csvField(value: string): string {
  // CSV has no types: a leading =, +, - or @ would run as a formula in
  // the application that opens it. Prefixed with an apostrophe.
  const safe =
    /^[=+\-@\t\r]/u.test(value) && !/^-?\d/u.test(value) ? `'${value}` : value;
  return /[",\n\r]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csvCell(cell: QSheetCell): string {
  if (cell === null) return "";
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "object") return `${cell.amount} ${cell.currency}`;
  return cell;
}

/**
 * The first sheet as CSV (RFC 4180, CRLF, UTF-8 with a byte-order mark so
 * Excel reads accents correctly). Money keeps its currency beside the
 * amount; unknown stays an empty field. Totals and Sources are not in a
 * CSV: it has no formulas and one sheet, so the .xlsx is the full file.
 */
export function workbookToCsv(spec: QWorkbook): Uint8Array {
  const sheet = spec.sheets[0];
  const lines =
    sheet === undefined
      ? []
      : [
          sheet.columns.map((column) => csvField(column.label)).join(","),
          ...sheet.rows.map((cells) =>
            cells.map((cell) => csvField(csvCell(cell))).join(","),
          ),
        ];
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
