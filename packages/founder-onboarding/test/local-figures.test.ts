import { describe, expect, it } from "vitest";

import type { ExtractedBlock } from "@capital-q/evidence";

import {
  extractLocalFigures,
  FINANCIAL_MEASURES,
  localFiguresApply,
  measureForLabel,
  parsePeriod,
} from "../src/index.js";

/**
 * Owner decision 2026-10-28: a highly confidential financial document's key
 * figures are read by code, never by a model. Synthetic, deterministic
 * fixtures; the PDF fixtures (real files through the real parser) live in
 * apps/workers/test/local-figures-pdf.test.ts.
 */

let index = 0;
const at = (page: number) => ({ page, index: index++ });
const heading = (text: string, page = 1): ExtractedBlock => ({
  kind: "heading",
  level: 1,
  text,
  locator: at(page),
});
const paragraph = (text: string, page = 1): ExtractedBlock => ({
  kind: "paragraph",
  text,
  locator: at(page),
});
const table = (rows: string[][], page = 1): ExtractedBlock => ({
  kind: "table",
  rows,
  locator: at(page),
});

describe("FINANCIAL_MEASURES v1", () => {
  it("is a closed table: every synonym names exactly one measure", () => {
    const seen = new Map<string, string>();
    for (const measure of FINANCIAL_MEASURES) {
      for (const synonym of measure.synonyms) {
        expect(seen.get(synonym), synonym).toBeUndefined();
        seen.set(synonym, measure.key);
        const match = measureForLabel(synonym);
        expect(match?.kind === "MEASURE" && match.measure.key).toBe(
          measure.key,
        );
      }
    }
    expect(FINANCIAL_MEASURES.map((m) => m.key)).toEqual([
      "monthly_revenue",
      "annual_revenue",
      "gross_margin",
      "net_burn",
      "cash_balance",
      "runway_months",
      "paying_customers",
      "headcount",
      "cac",
      "churn",
    ]);
  });

  it("matches labels exactly after normalisation, never by resemblance", () => {
    expect(measureForLabel("MRR (USD)")).toMatchObject({ kind: "MEASURE" });
    expect(measureForLabel("Annualised MRR")).toMatchObject({
      measure: { key: "annual_revenue" },
    });
    expect(measureForLabel("Revenue")).toEqual({ kind: "PERIOD_REVENUE" });
    expect(measureForLabel("Revenue churn")).toBeNull();
    expect(measureForLabel("MRR growth")).toBeNull();
    expect(measureForLabel("Cash burn multiple")).toBeNull();
  });

  it("reads periods by shape alone", () => {
    expect(parsePeriod("Sep 2026")?.key).toBe("2026-09");
    expect(parsePeriod("September 2026 Actual")?.key).toBe("2026-09");
    expect(parsePeriod("Sep-26")?.key).toBe("2026-09");
    expect(parsePeriod("30 September 2026")).toMatchObject({
      key: "2026-09",
      asOf: "2026-09-30",
    });
    expect(parsePeriod("Q3 2026")?.key).toBe("2026-Q3");
    expect(parsePeriod("FY2025")?.key).toBe("2025");
    expect(parsePeriod("Sep 2026 Budget")).toBeNull();
    expect(parsePeriod("Total")).toBeNull();
  });

  it("applies to financial document types only", () => {
    expect(localFiguresApply({ documentType: "MANAGEMENT_ACCOUNTS" })).toBe(
      true,
    );
    expect(localFiguresApply({ documentType: "FINANCIAL_MODEL" })).toBe(true);
    expect(localFiguresApply({ documentType: "FINANCIAL" })).toBe(true);
    expect(localFiguresApply({ documentType: "PITCH_DECK" })).toBe(false);
  });
});

describe("extractLocalFigures", () => {
  it("reads a management-accounts table: latest actual month, currency kept, annualised MRR as annual", () => {
    const result = extractLocalFigures([
      heading("Management accounts — September 2026"),
      paragraph("All figures in USD."),
      table([
        ["Metric", "Aug 2026", "Sep 2026", "Sep 2026 Budget"],
        ["MRR", "48,000", "51,000", "60,000"],
        ["Annualised MRR", "576,000", "612,000", "720,000"],
        ["Net burn", "(61,000)", "(65,000)", "(55,000)"],
        ["Closing cash", "375,000", "310,000", "330,000"],
        ["Gross margin", "61%", "62%", "65%"],
        ["Headcount", "13", "14", "15"],
        ["Payroll", "40,000", "42,000", "41,000"],
      ]),
    ]);
    const by = new Map(result.candidates.map((c) => [c.measure, c]));
    expect(by.get("monthly_revenue")).toMatchObject({
      value: { kind: "MONEY", amount: "51000", currency: "USD" },
      period: { granularity: "MONTH", key: "2026-09" },
      cell: "51,000",
      confidence: "HIGH",
      locator: { page: 1, table: 1, row: 2, column: 3 },
    });
    expect(by.get("annual_revenue")).toMatchObject({
      value: { amount: "612000", currency: "USD" },
      period: { key: "2026-09" },
    });
    expect(by.get("net_burn")?.value).toMatchObject({ amount: "65000" });
    expect(by.get("cash_balance")?.value).toMatchObject({ amount: "310000" });
    expect(by.get("gross_margin")?.value).toEqual({
      kind: "PERCENT",
      value: "62",
    });
    expect(by.get("headcount")?.value).toEqual({ kind: "COUNT", value: "14" });
    // Payroll is not a measure of v1: never offered.
    expect([...by.keys()]).toHaveLength(6);
    expect(JSON.stringify(result.candidates)).not.toContain("60,000");
  });

  it("keeps a ₦ table with decimal commas exactly, in naira", () => {
    const result = extractLocalFigures([
      heading("Monthly report"),
      table([
        ["Indicator", "Aug 2026", "Sep 2026"],
        ["MRR", "₦ 40.100.000,00", "₦ 45.250.000,50"],
        ["Cash balance", "₦ 380.000.000,00", "₦ 352.500.000,00"],
        ["Gross margin", "55,5 %", "57,25 %"],
      ]),
    ]);
    const by = new Map(result.candidates.map((c) => [c.measure, c]));
    expect(by.get("monthly_revenue")?.value).toEqual({
      kind: "MONEY",
      amount: "45250000.5",
      currency: "NGN",
      currencyCertain: true,
    });
    expect(by.get("cash_balance")?.value).toMatchObject({
      amount: "352500000",
      currency: "NGN",
    });
    expect(by.get("gross_margin")?.value).toEqual({
      kind: "PERCENT",
      value: "57.25",
    });
  });

  it("applies a stated '000 scale and refuses a figure with no currency", () => {
    const scaled = extractLocalFigures([
      table([
        ["USD '000", "Sep 2026"],
        ["MRR", "51"],
      ]),
    ]);
    expect(scaled.candidates[0]?.value).toMatchObject({ amount: "51000" });
    const bare = extractLocalFigures([
      table([
        ["Metric", "Sep 2026"],
        ["MRR", "51,000"],
        ["Headcount", "14"],
      ]),
    ]);
    // Money with no stated currency is not money in a guessed one.
    expect(bare.candidates.map((c) => c.measure)).toEqual(["headcount"]);
  });

  it("offers nothing from an ambiguous table", () => {
    const result = extractLocalFigures([
      paragraph("All figures in USD."),
      // No period anywhere: a figure of no month is not offered.
      table([
        ["Metric", "Value"],
        ["MRR", "51,000"],
      ]),
      // Two columns for the same month, neither marked actual.
      table([
        ["Metric", "Sep 2026", "Sep 2026"],
        ["Cash", "310,000", "330,000"],
      ]),
      // "1.500" could be 1.5 or 1,500.
      table([
        ["Metric", "Sep 2026"],
        ["CAC", "1.500"],
      ]),
      // Two tables state different MRR for the same month: neither offered.
      table([
        ["Metric", "Oct 2026"],
        ["MRR", "51,000"],
      ]),
      table([
        ["Metric", "Oct 2026"],
        ["MRR", "65,000"],
      ]),
      // A quarter of "Revenue" is not a measure of v1.
      table([
        ["Metric", "Q3 2026"],
        ["Revenue", "150,000"],
      ]),
      // A cell with two figures.
      table([
        ["Metric", "Nov 2026"],
        ["Burn", "60,000 - 70,000"],
      ]),
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.ambiguousDropped).toBe(1);
  });

  it("reads a labelled line under a heading at MEDIUM confidence", () => {
    const result = extractLocalFigures([
      heading("Board update, September 2026"),
      paragraph("Runway: 5 months"),
      paragraph("Paying customers: 1,240"),
    ]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        measure: "runway_months",
        value: { kind: "MONTHS", value: "5" },
        confidence: "MEDIUM",
      }),
      expect.objectContaining({
        measure: "paying_customers",
        value: { kind: "COUNT", value: "1240" },
      }),
    ]);
  });

  it("is bounded: nothing past the twentieth page or the sixtieth table", () => {
    const late = extractLocalFigures([
      paragraph("All figures in USD.", 1),
      table(
        [
          ["Metric", "Sep 2026"],
          ["MRR", "51,000"],
        ],
        21,
      ),
    ]);
    expect(late.candidates).toEqual([]);
    const many = extractLocalFigures([
      paragraph("All figures in USD."),
      ...Array.from({ length: 60 }, () =>
        table([
          ["Metric", "Total"],
          ["Payroll", "1"],
        ]),
      ),
      table([
        ["Metric", "Sep 2026"],
        ["MRR", "51,000"],
      ]),
    ]);
    expect(many.tablesRead).toBe(60);
    expect(many.candidates).toEqual([]);
  });

  it("is deterministic: the same blocks give the same candidates", () => {
    const blocks = [
      paragraph("All figures in USD."),
      table([
        ["Metric", "Sep 2026"],
        ["MRR", "$51,000"],
      ]),
    ];
    expect(extractLocalFigures(blocks)).toEqual(extractLocalFigures(blocks));
  });
});
