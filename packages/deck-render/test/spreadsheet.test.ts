import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  QArtifactContentSchema,
  QWorkbookSchema,
  qArtifactExportFormats,
  type QArtifactVersion,
  type QWorkbook,
} from "@capital-q/contracts";

import {
  columnLetter,
  exportFormatsForVersion,
  renderArtifactFile,
  workbookToCsv,
  workbookToXlsx,
} from "../src/index.js";

/**
 * XLSX-001: a spreadsheet Q prepared leaves as a real .xlsx -- read back
 * here with exceljs, by what someone opening it in Excel gets: typed
 * cells, formats, a frozen header, real formulas, blanks for unknown,
 * and the Sources sheet last.
 */

const WORKBOOK: QWorkbook = QWorkbookSchema.parse({
  sheets: [
    {
      name: "Figures",
      columns: [
        { key: "figure", label: "Figure", type: "text" },
        { key: "amount", label: "Amount", type: "money", currency: "USD" },
        { key: "count", label: "Count", type: "number" },
        { key: "share", label: "Share", type: "percent" },
        { key: "asOf", label: "As of", type: "date" },
        { key: "verified", label: "Verified", type: "boolean" },
      ],
      rows: [
        [
          "Monthly revenue",
          { amount: "38000.50", currency: "USD" },
          null,
          "3.8",
          "2026-03-31",
          false,
        ],
        ['=HYPERLINK("x")', null, "6400", null, null, null],
        [
          "Loan book",
          { amount: "410000", currency: "USD" },
          "12",
          "10",
          null,
          true,
        ],
      ],
      totals: [
        { column: "amount", fn: "SUM" },
        { column: "count", fn: "AVERAGE" },
      ],
    },
  ],
  sources: [
    {
      sheet: "Figures",
      columns: ["Amount", "Count"],
      from: "Ledgerfold's published claims",
      truthClass: "USER_CLAIM",
      refs: [{ kind: "CLAIM", id: "c-1", label: "financial.loan_book" }],
    },
  ],
  provenance: "Prepared by Q from Capital Q records on 2026-10-28.",
});

async function readBack(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return workbook;
}

describe("the sheet contract", () => {
  it("refuses a cell of the wrong type for its column", () => {
    const bad = structuredClone(WORKBOOK) as unknown as {
      sheets: { rows: unknown[][] }[];
    };
    const row = bad.sheets[0]?.rows[0];
    if (row !== undefined) row[2] = "about 6k";
    expect(QWorkbookSchema.safeParse(bad).success).toBe(false);
  });

  it("refuses a money total across currencies", () => {
    const mixed = structuredClone(WORKBOOK) as unknown as {
      sheets: { rows: unknown[][] }[];
    };
    const row = mixed.sheets[0]?.rows[2];
    if (row !== undefined) row[1] = { amount: "5", currency: "GBP" };
    expect(QWorkbookSchema.safeParse(mixed).success).toBe(false);
  });

  it("refuses a total over a text column, a float amount, and a sheet named Sources", () => {
    expect(
      QWorkbookSchema.safeParse({
        ...WORKBOOK,
        sheets: [
          { ...WORKBOOK.sheets[0], totals: [{ column: "figure", fn: "SUM" }] },
        ],
      }).success,
    ).toBe(false);
    expect(
      QWorkbookSchema.safeParse({
        ...WORKBOOK,
        sheets: [{ ...WORKBOOK.sheets[0], name: "Sources" }],
      }).success,
    ).toBe(false);
    const float = structuredClone(WORKBOOK) as unknown as {
      sheets: { rows: unknown[][] }[];
    };
    const row = float.sheets[0]?.rows[0];
    if (row !== undefined) row[1] = { amount: 38000.5, currency: "USD" };
    expect(QWorkbookSchema.safeParse(float).success).toBe(false);
  });

  it("is an artifact's content, and a SPREADSHEET downloads as xlsx and csv", () => {
    expect(
      QArtifactContentSchema.safeParse({
        sections: [{ heading: "What is in it", body: "Figures." }],
        workbook: WORKBOOK,
      }).success,
    ).toBe(true);
    expect(qArtifactExportFormats("SPREADSHEET")).toEqual(["xlsx", "csv"]);
    expect(qArtifactExportFormats("MEMO")).toEqual(["pdf"]);
  });
});

describe("workbookToXlsx", () => {
  it("writes typed cells, formats, totals as formulas, and the Sources sheet", async () => {
    const bytes = await workbookToXlsx(WORKBOOK, { title: "Figures" });
    // A zip container (the OOXML package).
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const book = await readBack(bytes);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      "Figures",
      "Sources",
    ]);
    const sheet = book.getWorksheet("Figures");
    if (sheet === undefined) throw new Error("no sheet");

    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.getRow(1).getCell(2).value).toBe("Amount (USD)");
    expect(sheet.getRow(1).font?.bold).toBe(true);

    const revenue = sheet.getRow(2);
    expect(revenue.getCell(2).value).toBe(38000.5);
    expect(revenue.getCell(2).numFmt).toBe('#,##0.00 "USD"');
    expect(revenue.getCell(4).value).toBeCloseTo(0.038);
    expect(revenue.getCell(4).numFmt).toBe("0.0%");
    expect(revenue.getCell(5).value).toEqual(new Date("2026-03-31T00:00:00Z"));
    expect(revenue.getCell(5).numFmt).toBe("yyyy-mm-dd");
    expect(revenue.getCell(6).value).toBe(false);

    // Unknown stays blank, never zero.
    expect(revenue.getCell(3).value).toBeNull();
    expect(sheet.getRow(3).getCell(2).value).toBeNull();
    // Text that looks like a formula is text.
    expect(sheet.getRow(3).getCell(1).value).toBe('=HYPERLINK("x")');
    expect(sheet.getRow(3).getCell(3).value).toBe(6400);
    expect(sheet.getRow(3).getCell(3).numFmt).toBe("#,##0");

    const totals = sheet.getRow(5);
    expect(totals.getCell(1).value).toBe("Total");
    expect(totals.getCell(2).value).toMatchObject({
      formula: "SUM(B2:B4)",
      result: 448000.5,
    });
    expect(totals.getCell(2).numFmt).toBe('#,##0.00 "USD"');
    // The average is over the known values only.
    expect(totals.getCell(3).value).toMatchObject({
      formula: "AVERAGE(C2:C4)",
      result: 3206,
    });

    expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(10);
    expect(sheet.getColumn(1).width).toBeLessThanOrEqual(60);

    const sources = book.getWorksheet("Sources");
    if (sources === undefined) throw new Error("no sources");
    expect(sources.getRow(1).values).toEqual([
      undefined,
      "Sheet",
      "Columns",
      "Where it came from",
      "Truth class",
      "Records",
    ]);
    expect(sources.getRow(2).getCell(4).value).toBe("USER_CLAIM");
    expect(sources.getRow(2).getCell(5).text).toContain(
      "financial.loan_book (CLAIM c-1)",
    );
    expect(sources.getRow(4).getCell(1).value).toBe(WORKBOOK.provenance);
  });

  it("names columns past Z as a spreadsheet does", () => {
    expect([1, 26, 27, 52, 703].map(columnLetter)).toEqual([
      "A",
      "Z",
      "AA",
      "AZ",
      "AAA",
    ]);
  });
});

describe("workbookToCsv", () => {
  it("writes the first sheet with blanks for unknown, money with its currency, and no formulas", () => {
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      workbookToCsv(WORKBOOK),
    );
    expect(text.startsWith("﻿")).toBe(true);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("Figure,Amount,Count,Share,As of,Verified");
    expect(lines[1]).toBe("Monthly revenue,38000.50 USD,,3.8,2026-03-31,FALSE");
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",,6400,,,`);
  });
});

describe("renderArtifactFile for a spreadsheet", () => {
  const version: QArtifactVersion = {
    artifactId:
      "6f1d1c8e-8a43-4f3a-9a52-1d7a9b8f0a01" as QArtifactVersion["artifactId"],
    version: 1,
    title: "Ledgerfold figures",
    summary: "Ledgerfold's published figures.",
    content: {
      sections: [{ heading: "What is in it", body: "Figures.", findings: [] }],
      gaps: [],
      workbook: WORKBOOK,
    },
    createdAt: "2026-10-28T10:00:00.000Z",
  };

  it("offers xlsx and csv, and refuses pdf and pptx", async () => {
    expect(exportFormatsForVersion(version)).toEqual(["xlsx", "csv"]);
    const xlsx = await renderArtifactFile({
      type: "SPREADSHEET",
      version,
      format: "xlsx",
    });
    expect(xlsx?.extension).toBe("xlsx");
    expect(xlsx?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const csv = await renderArtifactFile({
      type: "SPREADSHEET",
      version,
      format: "csv",
    });
    expect(csv?.contentType).toBe("text/csv; charset=utf-8");
    expect(
      await renderArtifactFile({ type: "SPREADSHEET", version, format: "pdf" }),
    ).toBeNull();
  });

  it("refuses xlsx for a document that is not a spreadsheet", async () => {
    const { workbook: _none, ...content } = version.content;
    expect(
      await renderArtifactFile({
        type: "MEMO",
        version: { ...version, content },
        format: "xlsx",
      }),
    ).toBeNull();
  });
});
