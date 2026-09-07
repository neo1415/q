import { describe, expect, it } from "vitest";

import { ParserOutputSchema } from "@capital-q/evidence/contracts";

import {
  buildXlsx,
  buildZip,
  SYNTHETIC_FIXTURES,
} from "../src/dev/fixtures.js";
import {
  createContentExtractorRegistry,
  createTextExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import { OoxmlRefusedError } from "../src/parser/ooxml.js";
import {
  columnIndex,
  columnLetters,
  createCsvExtractor,
  createXlsxExtractor,
  parseCsv,
} from "../src/parser/spreadsheets.js";

/**
 * Spreadsheet extraction (CQ-RAG-001 §18-§19, §55).
 *
 * A workbook comes out as bounded range blocks that keep the sheet, the A1
 * range and every cell's text, so a later chunk can carry "Revenue, B2" and
 * its labels together. Nothing is evaluated: a formula's cached value is
 * read, a formula without one yields nothing, and a macro project is a
 * refusal. No financial meaning is attached anywhere.
 */

const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;

function rawWorkbook(
  sheetXml: string,
  extra: readonly { name: string; content: string }[] = [],
) {
  return buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    {
      name: "xl/workbook.xml",
      content: xml(
        `<workbook xmlns:r="r"><sheets><sheet name="Model" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: xml(
        `<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", content: xml(sheetXml) },
    ...extra,
  ]);
}

describe("column references", () => {
  it("round-trips letters and indexes", () => {
    expect(columnIndex("A")).toBe(1);
    expect(columnIndex("Z")).toBe(26);
    expect(columnIndex("AA")).toBe(27);
    expect(columnLetters(28)).toBe("AB");
    expect(columnLetters(columnIndex("XFD"))).toBe("XFD");
  });
});

describe("xlsx extractor", () => {
  it("keeps sheet, range, row and column positions with values as text", async () => {
    const extractor = createXlsxExtractor();
    const output = await extractor.extract(
      buildXlsx([
        {
          name: "Revenue",
          rows: [
            ["Metric", "2025", "2026"],
            ["Revenue", 205000, 240000],
            ["Gross Margin", 0.61, true],
          ],
        },
        { name: "Notes", rows: [["Synthetic only"]] },
      ]),
      context,
    );
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.metadata).toEqual({
      parser: "ooxml_xlsx",
      parserVersion: "1.0.0",
    });
    expect(output.blocks).toHaveLength(2);
    expect(output.blocks[0]).toEqual({
      kind: "spreadsheet_range",
      sheet: "Revenue",
      range: "A1:C3",
      rows: [
        ["Metric", "2025", "2026"],
        ["Revenue", "205000", "240000"],
        ["Gross Margin", "0.61", "TRUE"],
      ],
      locator: {
        index: 0,
        sheet: "Revenue",
        range: "A1:C3",
        rowStart: 1,
        rowEnd: 3,
      },
    });
    expect(output.blocks[1]).toMatchObject({
      sheet: "Notes",
      range: "A1:A1",
      rows: [["Synthetic only"]],
    });
  });

  it("reads a formula's cached value and never evaluates the formula", async () => {
    const extractor = createXlsxExtractor();
    const output = await extractor.extract(
      rawWorkbook(
        `<worksheet><sheetData>
          <row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>
          <row r="2"><c r="A2"><f>SUM(A1:B1)</f><v>3</v></c><c r="B2"><f>A1*B1</f></c><c r="C2" t="str"><f>CONCAT("x","y")</f><v>xy</v></c></row>
        </sheetData></worksheet>`,
      ),
      context,
    );
    expect(output.blocks[0]).toMatchObject({
      range: "A1:C2",
      rows: [
        ["1", "2", ""],
        ["3", "", "xy"],
      ],
    });
    expect(JSON.stringify(output)).not.toContain("SUM(");
  });

  it("preserves sparse row numbers and inline strings", async () => {
    const extractor = createXlsxExtractor();
    const output = await extractor.extract(
      rawWorkbook(
        `<worksheet><sheetData>
          <row r="4"><c r="B4" t="inlineStr"><is><t>Label</t></is></c><c r="D4"><v>7</v></c></row>
          <row r="9"><c r="C9"><v>8</v></c></row>
        </sheetData></worksheet>`,
      ),
      context,
    );
    expect(output.blocks[0]).toMatchObject({
      range: "B4:D9",
      rows: [
        ["Label", "", "7"],
        ["", "8", ""],
      ],
      locator: { rowStart: 4, rowEnd: 9 },
    });
  });

  it("refuses a package carrying a macro project", () => {
    const extractor = createXlsxExtractor();
    const attempt = () =>
      extractor.extract(
        rawWorkbook(`<worksheet><sheetData/></worksheet>`, [
          {
            name: "xl/vbaProject.bin",
            content: "not a macro, but named like one",
          },
        ]),
        context,
      );
    expect(attempt).toThrow(OoxmlRefusedError);
    expect(attempt).toThrow(/macro project/);
  });

  it("refuses a package without a workbook", () => {
    const extractor = createXlsxExtractor();
    expect(() =>
      extractor.extract(
        buildZip([{ name: "[Content_Types].xml", content: "<Types/>" }]),
        context,
      ),
    ).toThrow(OoxmlRefusedError);
  });

  it("windows a long sheet into bounded ranges and says when it truncates", async () => {
    const extractor = createXlsxExtractor();
    const rows = Array.from({ length: 250 }, (_row, at) => [
      `row ${String(at + 1)}`,
      at,
    ]);
    const output = await extractor.extract(
      buildXlsx([{ name: "Long", rows }]),
      {
        limits: {
          ...EXTRACTION_PARSER_LIMITS,
          maxRangeRows: 100,
          maxRowsPerSheet: 200,
        },
      },
    );
    expect(output.metadata.truncated).toBe(true);
    expect(output.blocks).toHaveLength(2);
    expect(output.blocks[0]).toMatchObject({ range: "A1:B100" });
    expect(output.blocks[1]).toMatchObject({ range: "A101:B200" });
  });

  it("stops at the sheet limit", async () => {
    const extractor = createXlsxExtractor();
    const output = await extractor.extract(
      buildXlsx([
        { name: "One", rows: [["a"]] },
        { name: "Two", rows: [["b"]] },
        { name: "Three", rows: [["c"]] },
      ]),
      { limits: { ...EXTRACTION_PARSER_LIMITS, maxSheets: 2 } },
    );
    expect(output.blocks.map((b) => b.locator.sheet)).toEqual(["One", "Two"]);
    expect(output.metadata.truncated).toBe(true);
  });
});

describe("csv extractor", () => {
  it("parses quoted fields, escaped quotes and CRLF into a range block", async () => {
    const extractor = createCsvExtractor();
    const output = await extractor.extract(
      Buffer.from(
        `${"\uFEFF"}name,note\r\n"Beta Works, plc","says ""hi"""\r\n\r\nGamma,plain\n`,
        "utf8",
      ),
      context,
    );
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.blocks).toEqual([
      {
        kind: "spreadsheet_range",
        range: "A1:B3",
        rows: [
          ["name", "note"],
          ["Beta Works, plc", 'says "hi"'],
          ["Gamma", "plain"],
        ],
        locator: { index: 0, range: "A1:B3", rowStart: 1, rowEnd: 3 },
      },
    ]);
  });

  it("bounds records and fields", () => {
    const parsed = parseCsv("a,b,c\n1,2,3\n4,5,6\n", {
      maxRecords: 2,
      maxFields: 2,
    });
    expect(parsed.records).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parsed.truncated).toBe(true);
  });

  it("is chosen for text/csv while plain text keeps the text extractor", () => {
    const registry = createContentExtractorRegistry([
      createXlsxExtractor(),
      createCsvExtractor(),
      createTextExtractor(),
    ]);
    expect(
      registry.resolve({
        mimeType: "text/csv",
        filename: "a.csv",
        sizeBytes: 1,
      })?.id,
    ).toBe("csv");
    expect(
      registry.resolve({
        mimeType: "text/plain",
        filename: "a.txt",
        sizeBytes: 1,
      })?.id,
    ).toBe("text");
    expect(
      registry.resolve({
        mimeType: XLSX_MIME,
        filename: "a.xlsx",
        sizeBytes: 1,
      })?.id,
    ).toBe("ooxml_xlsx");
  });
});

describe("synthetic fixtures", () => {
  it("every built-in fixture extracts with its locators", async () => {
    const registry = createContentExtractorRegistry([
      createXlsxExtractor(),
      createCsvExtractor(),
      createTextExtractor(),
    ]);
    for (const fixture of SYNTHETIC_FIXTURES) {
      const extractor = registry.resolve({
        mimeType: fixture.mimeType,
        filename: fixture.filename,
        sizeBytes: 1,
      });
      if (extractor === null) continue; // pdf/docx/pptx are covered in extractors.test.ts
      const output = await extractor.extract(fixture.build(), context);
      expect(output.blocks.length).toBeGreaterThan(0);
      expect(
        output.blocks.every(
          (b) =>
            b.locator.range !== undefined || b.locator.lineStart !== undefined,
        ),
      ).toBe(true);
    }
  });
});
