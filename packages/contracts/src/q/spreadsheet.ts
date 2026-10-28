import { z } from "zod";

import { DecimalStringSchema } from "../common/decimal.js";
import { CurrencyCodeSchema, MoneySchema } from "../common/money.js";
import { TruthClassSchema } from "../evidence/vocabulary.js";

/**
 * A spreadsheet Q prepared (XLSX-001): the typed sheet spec a SPREADSHEET
 * artifact stores, and the only thing its .xlsx and .csv are drawn from.
 *
 * The same invariant as every artifact: derived material. A cell saying a
 * company's revenue is 38,000 USD does not make that a fact; it records
 * that Q copied that figure from a record the reader was already allowed
 * to see. So every cell is typed (a renderer never guesses what "38k"
 * means), money is an exact decimal plus its own ISO currency (never a
 * float, never a default currency), and `null` is how a cell says "not
 * known" -- drawn blank, never as zero.
 *
 * Code writes the cells, from typed records; a model may at most name a
 * sheet and choose which of the builder's typed columns to keep. A formula
 * is a typed total over one column (SUM or AVERAGE), never free text, so
 * nothing in a stored spreadsheet can be an expression somebody else wrote.
 * Where each column came from travels with it (`sources`), and is drawn as
 * the workbook's last sheet, "Sources".
 */

export const Q_SHEET_COLUMN_TYPES = [
  "text",
  "number",
  "money",
  "percent",
  "date",
  "boolean",
] as const;
export const QSheetColumnTypeSchema = z.enum(Q_SHEET_COLUMN_TYPES);
export type QSheetColumnType = z.infer<typeof QSheetColumnTypeSchema>;

export const Q_SHEETS_MAX = 6;
export const Q_SHEET_COLUMNS_MAX = 24;
export const Q_SHEET_ROWS_MAX = 500;
export const Q_SHEET_TEXT_MAX = 2_000;
export const Q_SHEET_SOURCES_MAX = 32;
/** Excel's own limit on a sheet's name. */
export const Q_SHEET_NAME_MAX = 31;
/** The sheet every workbook ends with; no data sheet may take its name. */
export const Q_SOURCES_SHEET_NAME = "Sources" as const;

/** Excel refuses these in a sheet name; refused here rather than mangled. */
const SHEET_NAME = /^[^[\]:*?/\\]+$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export const QSheetColumnSchema = z
  .object({
    /** Stable within the sheet: what a total names. */
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/u),
    label: z.string().trim().min(1).max(80),
    type: QSheetColumnTypeSchema,
    /**
     * A money column whose cells all share one currency says it here, so
     * its header can carry it. Every money cell still names its own.
     */
    currency: CurrencyCodeSchema.optional(),
  })
  .strict();
export type QSheetColumn = z.infer<typeof QSheetColumnSchema>;

/**
 * One cell. `null`: not known (drawn blank). number and percent are exact
 * decimal strings like money's amount; a percent is in points ("3.8" is
 * 3.8 %). A date is YYYY-MM-DD.
 */
export const QSheetCellSchema = z.union([
  z.null(),
  z.boolean(),
  MoneySchema.strict(),
  z.string().max(Q_SHEET_TEXT_MAX),
]);
export type QSheetCell = z.infer<typeof QSheetCellSchema>;

/** Whether `cell` is what a column of `type` may hold. */
export function qSheetCellFits(type: QSheetColumnType, cell: QSheetCell) {
  if (cell === null) return true;
  switch (type) {
    case "text":
      return typeof cell === "string";
    case "number":
    case "percent":
      return (
        typeof cell === "string" && DecimalStringSchema.safeParse(cell).success
      );
    case "money":
      return typeof cell === "object";
    case "date":
      return typeof cell === "string" && ISO_DATE.test(cell);
    case "boolean":
      return typeof cell === "boolean";
  }
}

export const Q_SHEET_TOTAL_FUNCTIONS = ["SUM", "AVERAGE"] as const;
export const QSheetTotalSchema = z
  .object({
    column: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/u),
    fn: z.enum(Q_SHEET_TOTAL_FUNCTIONS),
  })
  .strict();
export type QSheetTotal = z.infer<typeof QSheetTotalSchema>;

export const QSheetSchema = z
  .object({
    name: z.string().trim().min(1).max(Q_SHEET_NAME_MAX).regex(SHEET_NAME),
    columns: z.array(QSheetColumnSchema).min(1).max(Q_SHEET_COLUMNS_MAX),
    rows: z
      .array(z.array(QSheetCellSchema).max(Q_SHEET_COLUMNS_MAX))
      .max(Q_SHEET_ROWS_MAX),
    /** A totals row under the data, as real formulas. */
    totals: z.array(QSheetTotalSchema).max(Q_SHEET_COLUMNS_MAX).default([]),
  })
  .strict()
  .superRefine((sheet, context) => {
    const keys = sheet.columns.map((column) => column.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "column keys are unique" });
    }
    sheet.rows.forEach((row, at) => {
      if (row.length !== sheet.columns.length) {
        context.addIssue({
          code: "custom",
          path: ["rows", at],
          message: "every row carries exactly one cell per column",
        });
        return;
      }
      row.forEach((cell, index) => {
        const column = sheet.columns[index];
        if (column !== undefined && !qSheetCellFits(column.type, cell)) {
          context.addIssue({
            code: "custom",
            path: ["rows", at, index],
            message: `a ${column.type} column holds only ${column.type} cells`,
          });
        }
      });
    });
    for (const total of sheet.totals) {
      const at = keys.indexOf(total.column);
      const column = sheet.columns[at];
      if (
        column === undefined ||
        (column.type !== "number" &&
          column.type !== "money" &&
          column.type !== "percent")
      ) {
        context.addIssue({
          code: "custom",
          path: ["totals"],
          message: "a total is over a number, money or percent column",
        });
        continue;
      }
      if (column.type === "money") {
        // Adding pounds to dollars is not arithmetic; such a total is refused.
        const currencies = new Set(
          sheet.rows.flatMap((row) => {
            const cell = row[at];
            return cell !== null && typeof cell === "object"
              ? [cell.currency]
              : [];
          }),
        );
        if (currencies.size > 1) {
          context.addIssue({
            code: "custom",
            path: ["totals"],
            message: "a money total is over one currency",
          });
        }
      }
    }
  });
export type QSheet = z.infer<typeof QSheetSchema>;

/** A record a column's values were copied from. */
export const Q_SHEET_SOURCE_REF_KINDS = [
  "RELATIONSHIP",
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "CLAIM",
  "Q_ANSWER",
] as const;
export const QSheetSourceRefSchema = z
  .object({
    kind: z.enum(Q_SHEET_SOURCE_REF_KINDS),
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * Where the values in some columns came from, with their truth class.
 * `truthClass` null: not one class for the whole column -- it differs by
 * row (and the sheet carries it in its own column), or each value keeps
 * the standing it had in the cited answer.
 */
export const QSheetSourceSchema = z
  .object({
    sheet: z.string().trim().min(1).max(Q_SHEET_NAME_MAX),
    columns: z.array(z.string().max(80)).min(1).max(Q_SHEET_COLUMNS_MAX),
    from: z.string().trim().min(1).max(300),
    truthClass: TruthClassSchema.nullable(),
    refs: z.array(QSheetSourceRefSchema).max(50).default([]),
  })
  .strict();
export type QSheetSource = z.infer<typeof QSheetSourceSchema>;

export const QWorkbookSchema = z
  .object({
    sheets: z.array(QSheetSchema).min(1).max(Q_SHEETS_MAX),
    sources: z.array(QSheetSourceSchema).min(1).max(Q_SHEET_SOURCES_MAX),
    /** One line under the Sources sheet: who prepared it, from what, when. */
    provenance: z.string().trim().min(1).max(400),
  })
  .strict()
  .superRefine((workbook, context) => {
    const names = workbook.sheets.map((sheet) => sheet.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: "custom", message: "sheet names are unique" });
    }
    if (names.includes(Q_SOURCES_SHEET_NAME.toLowerCase())) {
      context.addIssue({
        code: "custom",
        message: `"${Q_SOURCES_SHEET_NAME}" is the workbook's own last sheet`,
      });
    }
  });
export type QWorkbook = z.infer<typeof QWorkbookSchema>;
