import { describe, expect, it } from "vitest";

import { CHART_METRICS, type ChartMetric } from "@capital-q/q-core";

import { RunRead, type ReadCompanyFigure } from "../src/q/card-subjects.js";
import {
  chartMetricOf,
  chartNotDrawnFact,
  chartNotDrawnLine,
  chartOutcome,
  figureChartBlock,
  previousChartOf,
} from "../src/q/figure-chart.js";

/**
 * A8 (owner directive 13 Nov 2026): which figure a chart draws is the turn
 * reader's typed metric (TURN_READER v82), validated by code against the
 * figures read. No regex over their words, no revenue-first default; a
 * metric with no data is said to have none, never swapped for another.
 */

const A = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const B = "7e5a7a76-857a-4528-9641-08c7bab9cc22";

const dated = (
  key: string,
  kind: "MONEY" | "COUNT" | "PERCENT",
  points: readonly (readonly [string, string | number])[],
): ReadCompanyFigure[] =>
  points.map(([asOf, value]) => ({
    key,
    statement: "Prose with 999,999 that is never charted.",
    asOf,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    value:
      kind === "MONEY"
        ? { kind, amount: String(value), currency: "USD", asOf }
        : { kind, value, asOf },
  }));

const SERIES: Readonly<Record<string, ReadCompanyFigure[]>> = {
  mrr: dated("financial.mrr", "MONEY", [
    ["2026-06-30", "30000"],
    ["2026-07-31", "34000"],
    ["2026-08-31", "38000"],
  ]),
  arr: dated("financial.arr", "MONEY", [
    ["2026-03-31", "300000"],
    ["2026-09-30", "480000"],
  ]),
  retention: dated("traction.logo_retention_6m_pct", "PERCENT", [
    ["2026-06-30", 88],
    ["2026-09-30", 91],
  ]),
  users: dated("traction.active_users", "COUNT", [
    ["2026-06-30", 1200],
    ["2026-09-30", 2100],
  ]),
};

const growth: ReadCompanyFigure = {
  key: "traction.growth",
  statement: "Revenue grew 60% from June to September.",
  asOf: "2026-09-30",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  value: {
    kind: "PERCENT",
    value: 60,
    metric: "REVENUE",
    currency: "USD",
    startAmount: "3000",
    endAmount: "4800",
    periodStart: "2026-06-30",
    periodEnd: "2026-09-30",
  },
};

function read(figures: Readonly<Record<string, readonly ReadCompanyFigure[]>>) {
  const run = new RunRead();
  const names: Record<string, string> = {
    [A]: "Ledgerline",
    [B]: "Clinicrest",
  };
  for (const [id, own] of Object.entries(figures)) {
    run.companyNames.set(id, names[id] ?? id);
    run.companyFigures.set(id, own);
  }
  return run;
}

const everything = () =>
  read({
    [A]: [
      ...(SERIES["mrr"] ?? []),
      ...(SERIES["arr"] ?? []),
      ...(SERIES["retention"] ?? []),
      ...(SERIES["users"] ?? []),
      growth,
    ],
  });

describe("the reader's metric chooses the figure, code validates it", () => {
  const cases: readonly (readonly [ChartMetric, string, number[]])[] = [
    ["MRR", "Ledgerline: monthly recurring revenue", [30000, 34000, 38000]],
    ["ARR", "Ledgerline: annual recurring revenue", [300000, 480000]],
    ["RETENTION", "Ledgerline: logo retention 6m pct", [88, 91]],
    ["USERS", "Ledgerline: active users", [1200, 2100]],
    ["GROWTH", "Ledgerline: revenue", [3000, 4800]],
  ];
  for (const [metric, title, values] of cases) {
    it(`${metric} draws its own series and no other`, () => {
      const outcome = chartOutcome({ read: everything(), metric });
      expect(outcome.kind).toBe("DRAWN");
      if (outcome.kind !== "DRAWN") return;
      expect(outcome.metric).toBe(metric);
      expect(outcome.block.kind === "CHART" && outcome.block.title).toBe(title);
      expect(
        outcome.block.kind === "CHART" &&
          outcome.block.series[0]?.points.map((point) => point.value),
      ).toEqual(values);
      expect(JSON.stringify(outcome.block)).not.toContain("999");
    });
  }

  it("a metric with no data is said to have none, never another metric drawn", () => {
    const run = read({ [A]: SERIES["mrr"] ?? [] });
    for (const metric of [
      "ARR",
      "RETENTION",
      "USERS",
      "GROSS_MARGIN",
    ] as const) {
      const outcome = chartOutcome({ read: run, metric, companies: [A] });
      expect(outcome).toEqual({
        kind: "NO_DATA",
        metric,
        missing: ["Ledgerline"],
      });
      expect(
        figureChartBlock({ read: run, metric, companies: [A] }),
      ).toBeNull();
    }
  });

  it("a comparison missing the metric for one company names it, and draws nothing", () => {
    const outcome = chartOutcome({
      read: read({ [A]: SERIES["mrr"] ?? [], [B]: SERIES["users"] ?? [] }),
      metric: "MRR",
      companies: [A, B],
    });
    expect(outcome).toEqual({
      kind: "NO_DATA",
      metric: "MRR",
      missing: ["Clinicrest"],
    });
  });

  it("a company whose figures were not read (not admitted) is missing, not left out", () => {
    const run = read({ [A]: SERIES["mrr"] ?? [] });
    run.companyNames.set(B, "Clinicrest");
    expect(
      chartOutcome({ read: run, metric: "MRR", companies: [A, B] }),
    ).toEqual({ kind: "NO_DATA", metric: "MRR", missing: ["Clinicrest"] });
  });

  it("UNSPECIFIED with exactly one drawable metric draws it", () => {
    const outcome = chartOutcome({
      read: read({ [A]: SERIES["users"] ?? [] }),
      metric: "UNSPECIFIED",
    });
    expect(outcome.kind === "DRAWN" && outcome.metric).toBe("USERS");
  });

  it("UNSPECIFIED with several drawable metrics asks which, with no revenue default", () => {
    const outcome = chartOutcome({ read: everything(), metric: "UNSPECIFIED" });
    expect(outcome.kind).toBe("ASK_METRIC");
    if (outcome.kind !== "ASK_METRIC") return;
    expect(outcome.available).toEqual([
      "MRR",
      "ARR",
      "REVENUE",
      "RETENTION",
      "USERS",
    ]);
    const fact = chartNotDrawnFact(outcome);
    expect(fact?.statement).toMatch(/Ask them, in one short question/u);
    expect(fact?.statement).toContain("annual recurring revenue (ARR)");
    expect(fact?.statement).toMatch(/Never choose one for them/u);
    // The question is the answer: no could-not line beside it.
    expect(chartNotDrawnLine(outcome)).toBeNull();
  });

  it("a period keeps only its months", () => {
    const outcome = chartOutcome({
      read: read({ [A]: SERIES["mrr"] ?? [] }),
      metric: "MRR",
      period: { from: "2026-07", to: null },
    });
    expect(
      outcome.kind === "DRAWN" &&
        outcome.block.kind === "CHART" &&
        outcome.block.series[0]?.points.map((point) => point.label),
    ).toEqual(["Jul 2026", "Aug 2026"]);
  });

  it("a metric string from a request is a canonical metric or UNSPECIFIED", () => {
    for (const metric of CHART_METRICS)
      expect(chartMetricOf(metric)).toBe(metric);
    expect(chartMetricOf("revenue")).toBe("UNSPECIFIED");
    expect(chartMetricOf(undefined)).toBe("UNSPECIFIED");
  });

  it("says plainly what it could not draw", () => {
    expect(
      chartNotDrawnLine({
        kind: "NO_DATA",
        metric: "ARR",
        missing: ["Grow Bank"],
      }),
    ).toMatch(
      /annual recurring revenue \(ARR\) figure for Grow Bank, and I won't put another figure in its place/u,
    );
    const ambiguous = chartNotDrawnFact({
      kind: "AMBIGUOUS",
      said: "Kestrel",
      candidates: ["Kestrel", "Kestrel"],
    });
    expect(ambiguous?.statement).toMatch(
      /Ask them, in one line, which one they mean/u,
    );
    expect(ambiguous?.truthClass).toBe("UNKNOWN");
  });
});

describe("the previous chart, read back from Q's own CHART block", () => {
  it("gives its companies and its canonical metric", () => {
    const block = figureChartBlock({
      read: read({ [A]: SERIES["mrr"] ?? [] }),
      metric: "MRR",
    });
    expect(
      previousChartOf([
        { role: "USER", blocks: [] },
        { role: "Q", blocks: block === null ? [] : [block] },
        { role: "Q", blocks: [] },
      ]),
    ).toEqual({ companies: ["Ledgerline"], metric: "MRR" });
  });

  it("a bar chart's companies are its bars", () => {
    const block = figureChartBlock({
      read: read({
        [A]: dated("financial.arr", "MONEY", [["2026-09-30", "480000"]]),
        [B]: dated("financial.arr", "MONEY", [["2026-08-31", "200000"]]),
      }),
      metric: "ARR",
      companies: [B, A],
    });
    expect(block?.kind === "CHART" && block.chart).toBe("BAR");
    expect(
      previousChartOf([{ role: "Q", blocks: block === null ? [] : [block] }]),
    ).toEqual({ companies: ["Clinicrest", "Ledgerline"], metric: "ARR" });
  });

  it("is null when Q drew no chart", () => {
    expect(previousChartOf([{ role: "Q", blocks: [] }])).toBeNull();
  });
});
