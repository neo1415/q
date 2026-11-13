import { describe, expect, it } from "vitest";

import { RunRead } from "../src/q/card-subjects.js";
import { companyFiguresFacts } from "../src/q/company-fact.js";
import { comparisonTableBlock } from "../src/q/compare-table.js";
import { fitsInOutcome } from "../src/q/fit-cards.js";
import { latestFigures } from "../src/q/latest-figures.js";

import { fitFixture } from "./fit-fixture.js";

/**
 * A8 demo figures (13 Nov 2026): a company's history of one metric is
 * several CURRENT claims with different dates. A chart draws them all; a
 * reader that shows ONE value per metric shows the latest, never June as
 * today's.
 */

const money = (amount: string, asOf: string | null) => ({
  kind: "MONEY",
  amount,
  currency: "NGN",
  ...(asOf === null ? {} : { asOf }),
});

const figure = (
  key: string,
  statement: string,
  asOf: string | null,
  value: Record<string, unknown> | null = null,
) => ({
  key,
  statement,
  asOf,
  value,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  lifecycleStatus: "CURRENT" as const,
});

const history = [
  figure(
    "financial.mrr",
    "MRR NGN 31.7m in June 2026.",
    "2026-06-30",
    money("31722470", "2026-06-30"),
  ),
  figure(
    "financial.mrr",
    "MRR NGN 38m in September 2026.",
    "2026-09-30",
    money("38000000", "2026-09-30"),
  ),
  figure(
    "financial.mrr",
    "MRR NGN 33.7m in July 2026.",
    "2026-07-31",
    money("33690377", "2026-07-31"),
  ),
];

describe("latest reading per metric", () => {
  it("the latest dated reading wins, whatever the listing order", () => {
    expect(latestFigures(history).map((f) => f.statement)).toEqual([
      "MRR NGN 38m in September 2026.",
    ]);
  });

  it("a dated reading beats an undated one; with no dates every reading stays", () => {
    const undated = figure(
      "traction.customers",
      "About 1,000 customers.",
      null,
    );
    const dated = figure(
      "traction.customers",
      "1,140 customers in September 2026.",
      "2026-09-30",
    );
    expect(latestFigures([undated, dated])).toEqual([dated]);
    const other = figure(
      "traction.customers",
      "Roughly 1,100 customers.",
      null,
    );
    expect(latestFigures([undated, other])).toEqual([undated, other]);
  });

  it("two different values for the same latest date both stay: a contradiction", () => {
    const a = figure(
      "financial.mrr",
      "MRR NGN 38m.",
      "2026-09-30",
      money("38000000", "2026-09-30"),
    );
    const b = figure(
      "financial.mrr",
      "MRR NGN 40m.",
      "2026-09-30",
      money("40000000", "2026-09-30"),
    );
    expect(latestFigures([...history, b])).toEqual([history[1], b]);
    // Identical readings collapse to the first listed (the latest asserted).
    expect(latestFigures([a, { ...a, statement: "Same, restated." }])).toEqual([
      a,
    ]);
  });

  it("keys are independent", () => {
    const team = figure("team.employee_count", "14 staff.", "2026-03-31");
    expect(latestFigures([...history, team])).toEqual([history[1], team]);
  });
});

describe("the comparison's traction cell", () => {
  it("states the latest month only, never an earlier one", () => {
    const ID = "6f075a0b-8372-4458-9060-09afd73a9c37";
    const OTHER = "b5280fd1-c2ee-4824-8658-09529453f7be";
    const read = new RunRead();
    read.companyNames.set(ID, "Ledgerline");
    read.companyNames.set(OTHER, "MedTrail");
    for (const id of [ID, OTHER])
      read.companyFacts.set(id, {
        about: "Fictional.",
        stageCode: "SEED",
        city: null,
        country: "NG",
        founded: null,
        website: null,
      });
    read.companyFigures.set(ID, history);
    const fits = [
      ...fitsInOutcome(fitFixture(ID, "Ledgerline", { STAGE: "STRONG" })),
      ...fitsInOutcome(fitFixture(OTHER, "MedTrail", { STAGE: "STRONG" })),
    ];
    const block = comparisonTableBlock({
      question: "compare Ledgerline and MedTrail side by side",
      read,
      fits,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    const cell = block.rows.find((row) => row.label === "Traction")?.cells[0];
    expect(cell).toContain("MRR NGN 38m in September 2026");
    expect(cell).not.toContain("June");
    expect(cell).not.toContain("July");
  });
});

describe("the figures the model is handed", () => {
  it("only the latest reading of each metric becomes a fact", () => {
    const facts = companyFiguresFacts(
      { companyId: "x", status: "AVAILABLE", figures: history },
      "Ledgerline",
    );
    expect(facts.map((f) => f.statement)).toEqual([
      "Ledgerline, as the company states it: MRR NGN 38m in September 2026.",
    ]);
  });

  it("keeps a same-date contradiction as two facts", () => {
    const b = figure(
      "financial.mrr",
      "MRR NGN 40m.",
      "2026-09-30",
      money("40000000", "2026-09-30"),
    );
    const facts = companyFiguresFacts(
      { companyId: "x", status: "AVAILABLE", figures: [...history, b] },
      "Ledgerline",
    );
    expect(facts).toHaveLength(2);
  });
});
