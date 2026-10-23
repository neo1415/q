import { describe, expect, it } from "vitest";

import { QResultBlockSchema } from "@capital-q/contracts";

import { RunRead, createRunCompanies } from "../src/q/card-subjects.js";
import {
  asksToCompare,
  comparisonTableBlock,
  compareTargets,
  newestAnswerCards,
} from "../src/q/compare-table.js";
import { fitsInOutcome } from "../src/q/fit-cards.js";

import { fitFixture } from "./fit-fixture.js";

/**
 * Owner 23 Oct 2026: "compare the top two side by side" (Mizan vs Silo
 * Credit) came back as two sentences and no table. The table is built by
 * code from what this run read, each cell saying where it comes from.
 */

const MIZAN = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const SILO = "7e5a7a76-857a-4528-9641-08c7bab9cc22";

function run() {
  const read = new RunRead();
  read.companyNames.set(MIZAN, "Mizan");
  read.companyNames.set(SILO, "Silo Credit");
  read.companyFacts.set(MIZAN, {
    about: "Sharia-compliant savings for gig workers.",
    stageCode: "SEED",
    city: "Cairo",
    country: "EG",
    founded: null,
    website: null,
  });
  read.companyFacts.set(SILO, {
    about: "Inventory credit for agri-dealers.",
    stageCode: "PRE_SEED",
    city: null,
    country: "KE",
    founded: null,
    website: null,
  });
  const fits = [
    ...fitsInOutcome(
      fitFixture(MIZAN, "Mizan", {
        STAGE: "STRONG",
        SECTOR: "STRONG",
        CHEQUE_SIZE: "STRONG",
      }),
    ),
    ...fitsInOutcome(
      fitFixture(SILO, "Silo Credit", { STAGE: "PARTIAL", SECTOR: "STRONG" }),
    ),
  ];
  return { read, fits };
}

describe("compare side by side", () => {
  it("knows a request to compare", () => {
    for (const asked of [
      "Compare the top two side by side",
      "Mizan vs Silo Credit?",
      "how do they stack up",
      "comparison of my saved companies",
    ]) {
      expect(asksToCompare(asked)).toBe(true);
    }
    expect(asksToCompare("Tell me about Mizan")).toBe(false);
  });

  it("a table from the run's reads, each cell labelled, unknown left empty", () => {
    const { read, fits } = run();
    const block = comparisonTableBlock({
      question: "Compare Silo Credit and Mizan side by side",
      read,
      fits,
    });
    expect(QResultBlockSchema.safeParse(block).success).toBe(true);
    if (block?.kind !== "TABLE") throw new Error("no table");
    // In the order the person named them.
    expect(block.columns.map((c) => c.label)).toEqual(["Silo Credit", "Mizan"]);
    expect(block.columns[0]?.subject).toEqual({
      kind: "COMPANY",
      companyId: SILO,
    });
    const cells = (label: string) =>
      block.rows.find((row) => row.label === label)?.cells;
    expect(cells("What they do")).toEqual([
      "Inventory credit for agri-dealers. (company-stated)",
      "Sharia-compliant savings for gig workers. (company-stated)",
    ]);
    expect(cells("Stage")).toEqual([
      "Pre Seed (company-stated)",
      "Seed (company-stated)",
    ]);
    expect(cells("Mandate fit")?.[1]).toContain("(Capital Q fit)");
    expect(cells("Cheque fit")?.[0]).toMatch(/^Not known: /u);
    expect(cells("Cheque fit")?.[1]).toMatch(/^Strong match: /u);
    expect(cells("Open questions")?.[0]).toContain("Cheque compatibility");
    // No row of nothing; a row the run has nothing for is left out.
    expect(block.rows.find((row) => row.label === "Raise")).toBeUndefined();
  });

  it("only when asked to compare, and only with two companies read", () => {
    const { read, fits } = run();
    expect(
      comparisonTableBlock({ question: "Tell me about Mizan", read, fits }),
    ).toBeNull();
    expect(
      comparisonTableBlock({
        question: "compare them",
        read: new RunRead(),
        fits: fits.slice(0, 1),
      }),
    ).toBeNull();
  });

  // Owner 23 Oct 2026: traction numbers first, as each company states them.
  it("the traction row leads with the company's own figures, dated, never verified", () => {
    const companies = createRunCompanies();
    companies.note("run-1", {
      toolName: "company.figures.read",
      status: "SUCCEEDED",
      classification: "READ_ONLY",
      result: {
        ok: true,
        data: {
          companyId: MIZAN,
          status: "AVAILABLE",
          figures: [
            {
              key: "team.size",
              statement: "12 full-time staff.",
              value: null,
              asOf: "2026-09-01",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
            {
              key: "revenue.mrr",
              statement: "Monthly recurring revenue is $42,000.",
              value: null,
              asOf: "2026-09-30",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
            {
              key: "customers.count",
              statement: "1,200 paying customers",
              value: null,
              asOf: null,
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
          ],
        },
      },
    } as never);
    const read = companies.take("run-1");
    const { read: base, fits } = run();
    for (const [id, name] of base.companyNames) read.companyNames.set(id, name);
    for (const [id, facts] of base.companyFacts)
      read.companyFacts.set(id, facts);
    const block = comparisonTableBlock({
      question: "compare Mizan and Silo Credit side by side",
      read,
      fits,
    });
    if (block?.kind !== "TABLE") throw new Error("no table");
    const traction = block.rows.find((row) => row.label === "Traction")?.cells;
    expect(traction?.[0]).toMatch(
      /^Monthly recurring revenue is \$42,000 \(company-stated, Sep 2026\); 1,200 paying customers \(company-stated\)/u,
    );
    // Not a traction figure: not in the traction row.
    expect(traction?.[0]).not.toContain("full-time staff");
    // A company that published none: only what the fit says, never a zero.
    expect(traction?.[1]).not.toContain("company-stated");
  });
});

describe("which companies a compare follow-up means", () => {
  const cards = [
    { companyId: MIZAN, name: "Mizan" },
    { companyId: SILO, name: "Silo Credit" },
    { companyId: "c3", name: "Kora" },
  ];

  it("the top two of the newest answer's cards", () => {
    expect(compareTargets("Compare the top two side by side", cards)).toEqual([
      MIZAN,
      SILO,
    ]);
    expect(compareTargets("compare the first three", cards)).toEqual([
      MIZAN,
      SILO,
      "c3",
    ]);
  });

  it("those it names, in the order named", () => {
    expect(compareTargets("Kora vs Mizan?", cards)).toEqual(["c3", MIZAN]);
  });

  it("nothing for a question that is not a comparison, or one card", () => {
    expect(compareTargets("Tell me more about Mizan", cards)).toEqual([]);
    expect(compareTargets("compare them", cards.slice(0, 1))).toEqual([]);
  });

  it("reads cards from Q's newest answer only", () => {
    const block = (ids: string[]) => ({
      kind: "ANSWER_CARDS",
      cards: ids.map((companyId) => ({
        name: companyId,
        subject: { kind: "COMPANY", companyId },
      })),
    });
    expect(
      newestAnswerCards([
        { role: "Q", blocks: [block(["old"])] },
        { role: "USER" },
        { role: "Q", blocks: [block(["a", "b"])] },
        { role: "USER" },
      ]).map((card) => card.companyId),
    ).toEqual(["a", "b"]);
  });
});
