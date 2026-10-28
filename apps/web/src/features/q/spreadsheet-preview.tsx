"use client";

import type { QSheetCell, QSheetColumn, QWorkbook } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

/**
 * XLSX-001: a spreadsheet Q prepared, previewed in the viewer.
 *
 * The first sheet as a table, drawn from the same stored workbook the
 * .xlsx is written from, so the preview and the file cannot disagree.
 * Wider than a phone, it scrolls inside the existing table scroll wrapper
 * and says so. A blank cell reads "Not known" -- never a zero or a dash
 * that could be read as one. Long sheets show their first rows; the file
 * has every row, the totals as formulas and the Sources sheet.
 */

export const SPREADSHEET_PREVIEW_ROWS = 50;

const formatter = (options: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(undefined, options);

/** A typed cell in words, or null when it is not known. */
export function previewCell(
  column: QSheetColumn,
  cell: QSheetCell,
): string | null {
  if (cell === null) return null;
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  if (typeof cell === "object") {
    // The amount as written, grouped for reading, with its own currency.
    const amount = Number(cell.amount);
    const shown = Number.isFinite(amount)
      ? formatter({ maximumFractionDigits: 2 }).format(amount)
      : cell.amount;
    return `${shown} ${cell.currency}`;
  }
  if (column.type === "number") {
    const value = Number(cell);
    return Number.isFinite(value)
      ? formatter({ maximumFractionDigits: 4 }).format(value)
      : cell;
  }
  if (column.type === "percent") return `${cell}%`;
  return cell;
}

export function SpreadsheetPreview({
  workbook,
}: {
  readonly workbook: QWorkbook;
}) {
  const t = useT();
  const sheet = workbook.sheets[0];
  if (sheet === undefined) return null;
  const rows = sheet.rows.slice(0, SPREADSHEET_PREVIEW_ROWS);
  const more = workbook.sheets.length - 1;
  return (
    <section
      aria-label={t("Spreadsheet preview")}
      className="flex flex-col gap-2"
      data-q-spreadsheet-preview
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="cq-title-sm text-(--cq-text-primary)">{sheet.name}</h3>
        <p className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "Download the Excel file for every row, its totals and its sources.",
          )}
        </p>
      </div>
      {sheet.columns.length > 2 ? (
        <p className="cq-caption text-(--cq-text-tertiary) sm:hidden">
          {t("Swipe sideways to see every column.")}
        </p>
      ) : null}
      <div className="cq-q-table-scroll relative max-h-[60dvh] overflow-auto rounded-md border border-(--cq-border-subtle)">
        <table className="w-full border-collapse text-start">
          <thead className="sticky top-0 bg-(--cq-surface-subtle)">
            <tr>
              {sheet.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`cq-label px-3 py-2 whitespace-nowrap text-(--cq-text-primary) ${column.type === "text" || column.type === "date" || column.type === "boolean" ? "text-start" : "text-end"}`}
                  data-q-spreadsheet-head={column.key}
                >
                  {column.type === "money" && column.currency !== undefined
                    ? `${column.label} (${column.currency})`
                    : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, at) => (
              <tr
                key={String(at)}
                className="border-t border-(--cq-border-subtle)"
                data-q-spreadsheet-row
              >
                {sheet.columns.map((column, index) => {
                  const shown = previewCell(column, cells[index] ?? null);
                  return (
                    <td
                      key={column.key}
                      className={`cq-body-sm px-3 py-2 align-top text-(--cq-text-primary) ${column.type === "text" ? "min-w-40 whitespace-pre-line" : "whitespace-nowrap tabular-nums"} ${column.type === "number" || column.type === "money" || column.type === "percent" ? "text-end" : "text-start"}`}
                    >
                      {shown === null ? (
                        <span className="text-(--cq-text-tertiary)">
                          {t("Not known")}
                        </span>
                      ) : column.type === "boolean" ? (
                        t(shown)
                      ) : (
                        shown
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.rows.length > rows.length ? (
        <p
          className="cq-caption text-(--cq-text-tertiary)"
          data-q-spreadsheet-more
        >
          {t(`Showing the first ${String(rows.length)} rows.`)}
        </p>
      ) : null}
      {more > 0 ? (
        <p className="cq-caption text-(--cq-text-tertiary)">
          {more === 1
            ? t("One more sheet is in the file.")
            : t(`${String(more)} more sheets are in the file.`)}
        </p>
      ) : null}
    </section>
  );
}
