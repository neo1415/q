import { describe, expect, it } from "vitest";

import { QResultBlockSchema } from "@capital-q/contracts";

import { RunRead, type ReadCompanyFigure } from "../src/q/card-subjects.js";
import { answerChart, figureChartBlock } from "../src/q/figure-chart.js";

/**
 * A8 (owner priority, 13 Nov 2026): Q answers with actual charts, built by
 * code from figures the run read under the firewall. Never invented,
 * interpolated, converted or filled; fewer than two comparable points is
 * no chart.
 */

const A = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const B = "7e5a7a76-857a-4528-9641-08c7bab9cc22";
const C = "7e5a7a76-857a-4528-9641-08c7bab9cc23";

const claim = (
  key: string,
  value: Record<string, unknown> | null,
  standing: Partial<
    Pick<ReadCompanyFigure, "truthClass" | "evidenceStatus">
  > = {},
): ReadCompanyFigure => ({
  key,
  statement: "A sentence with 999,999 in it that is never charted.",
  asOf: "2026-09-30T00:00:00.000Z",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  ...standing,
  value,
});

const mrr = (amount: string, currency = "USD", asOf = "2026-09-30") =>
  claim("financial.monthly_revenue", { kind: "MONEY", amount, currency, asOf });

const growth = (start: string, end: string, currency = "USD") =>
  claim("traction.growth", {
    kind: "PERCENT",
    value: 60,
    metric: "REVENUE",
    currency,
    startAmount: start,
    endAmount: end,
    periodStart: "2026-06-30",
    periodEnd: "2026-09-30",
  });

function read(
  companies: Readonly<
    Record<string, readonly [string, readonly ReadCompanyFigure[]]>
  >,
): RunRead {
  const run = new RunRead();
  for (const [id, [name, figures]] of Object.entries(companies)) {
    run.companyNames.set(id, name);
    run.companyFigures.set(id, figures);
  }
  return run;
}

const valid = (block: unknown) =>
  expect(QResultBlockSchema.safeParse(block).success).toBe(true);

describe("a chart from the figures this run read", () => {
  it("draws one company's time series from its own dated values", () => {
    const block = figureChartBlock({
      read: read({
        [A]: ["Ledgerline", [mrr("4800"), growth("3000", "4800")]],
      }),
      metric: "GROWTH",
    });
    valid(block);
    expect(block?.kind).toBe("CHART");
    if (block?.kind !== "CHART") throw new Error("no chart");
    expect(block.chart).toBe("LINE");
    expect(block.currency).toBe("USD");
    expect(block.unit).toBe("a month");
    expect(block.title).toBe("Ledgerline: monthly revenue");
    expect(block.series).toHaveLength(1);
    const [series] = block.series;
    expect(series?.points).toEqual([
      { label: "Jun 2026", value: 3000, asOf: "2026-06-30" },
      { label: "Sep 2026", value: 4800, asOf: "2026-09-30" },
    ]);
    // Company-stated, labelled as the claim it is; never verified.
    expect(series?.truthClass).toBe("USER_CLAIM");
    expect(series?.evidenceStatus).toBe("SELF_REPORTED");
    expect(series?.source).toMatch(/company-stated/iu);
    expect(series?.source).toMatch(/not verified/iu);
    // Nothing from the statement's prose.
    expect(JSON.stringify(block)).not.toContain("999");
  });

  it("compares one metric across companies, each bar with its own date", () => {
    const block = figureChartBlock({
      read: read({
        [A]: ["Ledgerline", [mrr("4800", "USD", "2026-09-30")]],
        [B]: ["Clinicrest", [mrr("6500", "USD", "2026-08-31")]],
      }),
      metric: "MRR",
      companies: [B, A],
    });
    valid(block);
    if (block?.kind !== "CHART") throw new Error("no chart");
    expect(block.chart).toBe("BAR");
    expect(block.currency).toBe("USD");
    expect(block.series).toHaveLength(1);
    expect(block.series[0]?.points).toEqual([
      { label: "Clinicrest", value: 6500, asOf: "2026-08-31" },
      { label: "Ledgerline", value: 4800, asOf: "2026-09-30" },
    ]);
  });

  it("draws two companies' series on one line when their dates match", () => {
    const block = figureChartBlock({
      read: read({
        [A]: ["Ledgerline", [mrr("4800"), growth("3000", "4800")]],
        [B]: ["Clinicrest", [mrr("6500"), growth("5000", "6500")]],
      }),
      metric: "MRR",
      companies: [A, B],
    });
    valid(block);
    if (block?.kind !== "CHART") throw new Error("no chart");
    expect(block.chart).toBe("LINE");
    expect(block.series.map((series) => series.label)).toEqual([
      "Ledgerline",
      "Clinicrest",
    ]);
  });

  it("never puts two currencies on one axis, and never converts", () => {
    expect(
      figureChartBlock({
        read: read({
          [A]: ["Ledgerline", [mrr("38000000", "NGN")]],
          [B]: ["Clinicrest", [mrr("95000", "USD")]],
        }),
        metric: "MRR",
        companies: [A, B],
      }),
    ).toBeNull();
  });

  it("never mixes kinds (money against a count)", () => {
    expect(
      figureChartBlock({
        read: read({
          [A]: [
            "Ledgerline",
            [claim("financial.monthly_revenue", { kind: "COUNT", value: 3 })],
          ],
          [B]: ["Clinicrest", [mrr("95000")]],
        }),
        metric: "MRR",
        companies: [A, B],
      }),
    ).toBeNull();
  });

  it("a single point is no chart", () => {
    expect(
      figureChartBlock({
        read: read({ [A]: ["Ledgerline", [mrr("4800")]] }),
        metric: "MRR",
      }),
    ).toBeNull();
  });

  it("charts none of a comparison when one company has no such figure", () => {
    expect(
      figureChartBlock({
        read: read({
          [A]: ["Ledgerline", []],
          [B]: ["Clinicrest", [mrr("95000")]],
          [C]: ["Mizan", [mrr("42000")]],
        }),
        metric: "MRR",
        companies: [A, B, C],
      }),
    ).toBeNull();
  });

  it("never draws prose, an estimate, an unknown or an unevidenced figure", () => {
    const noStructured = claim("financial.monthly_revenue", null);
    const reported = claim("traction.public_metric_1", {
      kind: "REPORTED_METRIC",
      text: "$550 million annualised volume",
    });
    const estimate = claim(
      "market.size",
      { kind: "MONEY", amount: "9", currency: "USD" },
      {
        truthClass: "ESTIMATE",
      },
    );
    const unknown = claim(
      "financial.gross_margin",
      { kind: "PERCENT", value: 70 },
      {
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
      },
    );
    for (const figures of [[noStructured], [reported], [estimate], [unknown]]) {
      expect(
        figureChartBlock({
          read: read({
            [A]: ["Ledgerline", figures],
            [B]: ["Clinicrest", figures],
          }),
          metric: "UNSPECIFIED",
        }),
      ).toBeNull();
    }
  });

  it("two different values for one date is a contradiction, never resolved", () => {
    expect(
      figureChartBlock({
        read: read({
          [A]: [
            "Ledgerline",
            [
              mrr("3000", "USD", "2026-06-30"),
              mrr("4800", "USD", "2026-09-30"),
              mrr("5100", "USD", "2026-09-30"),
            ],
          ],
        }),
        metric: "MRR",
      }),
    ).toBeNull();
  });

  it("a growth claim whose end is not the stated MRR stays its own series, never merged", () => {
    const block = figureChartBlock({
      read: read({
        [A]: ["Ledgerline", [mrr("5100"), growth("3000", "4800")]],
      }),
      metric: "REVENUE",
    });
    if (block?.kind !== "CHART") throw new Error("no chart");
    expect(block.title).toBe("Ledgerline: revenue");
    expect(block.series[0]?.points.map((point) => point.value)).toEqual([
      3000, 4800,
    ]);
  });

  it("keeps a document-backed claim's own standing, and verified says verified", () => {
    const block = figureChartBlock({
      read: read({
        [A]: [
          "Ledgerline",
          [
            claim(
              "financial.monthly_revenue",
              {
                kind: "MONEY",
                amount: "4800",
                currency: "USD",
                asOf: "2026-09-30",
              },
              { truthClass: "VERIFIED", evidenceStatus: "PLATFORM_VERIFIED" },
            ),
          ],
        ],
        [B]: [
          "Clinicrest",
          [
            claim(
              "financial.monthly_revenue",
              {
                kind: "MONEY",
                amount: "95000",
                currency: "USD",
                asOf: "2026-02-28",
              },
              { evidenceStatus: "DOCUMENT_SUPPORTED" },
            ),
          ],
        ],
      }),
      metric: "MRR",
      companies: [A, B],
    });
    valid(block);
    if (block?.kind !== "CHART") throw new Error("no chart");
    expect(block.series).toHaveLength(2);
    const [verified, claimed] = block.series;
    expect(verified?.truthClass).toBe("VERIFIED");
    expect(verified?.source).toMatch(/^Verified/u);
    expect(claimed?.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
    expect(claimed?.source).toMatch(/company-stated/iu);
  });

  it("chooses the metric they named among those read", () => {
    const block = figureChartBlock({
      read: read({
        [A]: [
          "Ledgerline",
          [
            mrr("4800"),
            claim("financial.gross_margin", {
              kind: "PERCENT",
              value: 78,
              asOf: "2026-09-30",
            }),
          ],
        ],
        [B]: [
          "Clinicrest",
          [
            mrr("6500"),
            claim("financial.gross_margin", {
              kind: "PERCENT",
              value: 72,
              asOf: "2026-09-30",
            }),
          ],
        ],
      }),
      metric: "GROSS_MARGIN",
      companies: [A, B],
    });
    if (block?.kind !== "CHART") throw new Error("no chart");
    expect(block.title).toMatch(/^Gross margin/u);
    expect(block.unit).toBe("%");
    expect(block.currency).toBeNull();
  });

  it("a comparison whose other company was not read draws nothing, not half", () => {
    expect(
      figureChartBlock({
        read: read({
          [A]: ["Ledgerline", [mrr("4800"), growth("3000", "4800")]],
        }),
        metric: "MRR",
        companies: [B, A],
      }),
    ).toBeNull();
  });

  it("a company with no name read is never drawn under a made-up one", () => {
    const run = new RunRead();
    run.companyFigures.set(A, [mrr("4800"), growth("3000", "4800")]);
    expect(figureChartBlock({ read: run, metric: "UNSPECIFIED" })).toBeNull();
  });
});

describe("which answers carry a chart (no chart spam)", () => {
  const run = () =>
    read({
      [A]: ["Ledgerline", [mrr("4800")]],
      [B]: ["Clinicrest", [mrr("6500")]],
    });
  const table = {
    kind: "TABLE" as const,
    title: "Ledgerline vs Clinicrest",
    columns: [
      {
        label: "Ledgerline",
        subject: { kind: "COMPANY" as const, companyId: A },
      },
      {
        label: "Clinicrest",
        subject: { kind: "COMPANY" as const, companyId: B },
      },
    ],
    rows: [{ label: "Stage", cells: ["Seed", "Seed"] }],
  };
  const base = {
    read: run(),
    metric: "UNSPECIFIED" as const,
    compareIds: [A, B],
  };

  it("an answer that asked for none and shows no table carries none", () => {
    expect(answerChart({ ...base, asked: false, blocks: [] })).toBeNull();
  });

  it("beside a comparison table, the table's companies' comparable metric", () => {
    const chart = answerChart({ ...base, asked: false, blocks: [table] });
    expect(chart?.kind).toBe("CHART");
  });

  it("never a second chart", () => {
    const chart = answerChart({ ...base, asked: true, blocks: [table] });
    expect(chart).not.toBeNull();
    expect(
      answerChart({
        ...base,
        asked: true,
        blocks: chart === null ? [] : [chart],
      }),
    ).toBeNull();
  });
});
