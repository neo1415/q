import { describe, expect, it } from "vitest";

import {
  QWorkbookSchema,
  type PermittedContextPlan,
  type QArtifactContent,
} from "@capital-q/contracts";

import {
  buildOwnFinancialModelSheet,
  createMakeSpreadsheetTool,
  createQToolExecutor,
  createQToolRegistry,
  decimalOfMinor,
  spreadsheetReceipt,
  type OwnFinancialFigure,
  type SpreadsheetPort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * Q-page sweep 2026-10-29 (F06): "Build my 12-month financial model as a
 * spreadsheet" was answered "nothing of that kind is on your record" while
 * Q then quoted the founder's own cash, burn and revenue. Their own model
 * is now built from their own figures, the months labelled as Q's
 * projection, unknown base figures asked for, held-back figures named and
 * never quoted.
 */

const TODAY = "2026-10-29";
const ARTIFACT = "66666666-6666-4666-8666-666666666666";

const told = (
  key: string,
  value: Record<string, unknown>,
  statement: string,
): OwnFinancialFigure => ({
  key,
  heldBack: false,
  statement,
  value,
  asOf: "2026-10-28",
});
const usd = (amount: string) => ({ kind: "MONEY", amount, currency: "USD" });

const LEDGERBRIDGE: readonly OwnFinancialFigure[] = [
  told(
    "financial.monthly_revenue",
    usd("65000"),
    "You told Q: revenue last month was USD 65,000.",
  ),
  told(
    "financial.burn_rate",
    usd("65000"),
    "You told Q: monthly net burn is USD 65,000.",
  ),
  told(
    "financial.cash_balance",
    usd("310000"),
    "You told Q: cash in the bank is USD 310,000.",
  ),
  told(
    "financial.revenue_trend",
    { kind: "TEXT", value: "growing" },
    "You told Q: revenue is growing.",
  ),
];

describe("the financial model builder", () => {
  it("projects 12 months from their figures, labelled Q's projection (ESTIMATE), with exact money", () => {
    const built = buildOwnFinancialModelSheet(
      {
        companyId: COMPANY_A,
        companyName: "LedgerBridge",
        figures: LEDGERBRIDGE,
        assumptions: {
          revenueGrowthPercentPerMonth: 10,
          costGrowthPercentPerMonth: 2,
          basis:
            "Your deck shows MRR rising from 31,000 in April to 65,000 in September.",
        },
        today: TODAY,
      },
      {},
    );
    expect(built).not.toBeNull();
    if (built === null) return;
    expect(QWorkbookSchema.safeParse(built.workbook).success).toBe(true);
    const [model, assumptions] = built.workbook.sheets;
    expect(model?.name).toBe("Model");
    expect(model?.rows).toHaveLength(12);
    // Months start the month after today.
    expect(model?.rows[0]?.[0]).toBe("2026-11-01");
    expect(model?.rows[11]?.[0]).toBe("2027-10-01");
    // Revenue 65,000 * 1.10 = 71,500; costs 130,000 * 1.02 = 132,600;
    // net burn 61,100; cash 310,000 - 61,100 = 248,900.
    const keys = model?.columns.map((column) => column.key) ?? [];
    const at = (key: string) => keys.indexOf(key);
    expect(model?.rows[0]?.[at("revenue")]).toEqual({
      amount: "71500",
      currency: "USD",
    });
    expect(model?.rows[0]?.[at("costs")]).toEqual({
      amount: "132600",
      currency: "USD",
    });
    expect(model?.rows[0]?.[at("netBurn")]).toEqual({
      amount: "61100",
      currency: "USD",
    });
    expect(model?.rows[0]?.[at("cashEnd")]).toEqual({
      amount: "248900",
      currency: "USD",
    });
    // Gross margin is not known: no gross profit column is invented.
    expect(keys).not.toContain("grossProfit");
    // The months are Q's estimate; the assumptions keep their own standing.
    expect(built.workbook.sources[0]).toMatchObject({
      sheet: "Model",
      truthClass: "ESTIMATE",
    });
    expect(built.workbook.sources[1]?.truthClass).toBeNull();
    const rows = assumptions?.rows ?? [];
    const row = (item: string) => rows.find((one) => one[0] === item);
    expect(row("Starting monthly revenue")?.[1]).toEqual({
      amount: "65000",
      currency: "USD",
    });
    expect(row("Starting monthly revenue")?.[3]).toMatch(/you told Q/u);
    expect(row("Revenue growth per month")?.slice(2, 4)).toEqual([
      "10",
      "Q's assumption",
    ]);
    // Unknown: said and asked for, never filled.
    expect(row("Gross margin")?.slice(1, 4)).toEqual([null, null, "Not known"]);
    expect(built.gaps.join(" ")).toMatch(/gross margin is not on your record/u);
    const says = spreadsheetReceipt(built);
    expect(says).toMatch(
      /projection from the figures you told me, not your figures/u,
    );
    expect(says).toMatch(/Not on your record: gross margin/u);
    expect(built.workbook.provenance).toMatch(/Q's projection, not your data/u);
  });

  it("holds a line flat, and says so, when no growth rate was given", () => {
    const built = buildOwnFinancialModelSheet(
      {
        companyId: COMPANY_A,
        companyName: "LedgerBridge",
        figures: LEDGERBRIDGE,
        assumptions: {},
        today: TODAY,
      },
      {},
    );
    const rows = built?.workbook.sheets[1]?.rows ?? [];
    const growth = rows.find((one) => one[0] === "Revenue growth per month");
    expect(growth?.[3]).toBe("Held flat (no rate given)");
    // Flat: cash falls by the stated net burn each month and runs out.
    const model = built?.workbook.sheets[0];
    const cashAt = model?.columns.findIndex((c) => c.key === "cashEnd") ?? -1;
    expect(model?.rows[0]?.[cashAt]).toEqual({
      amount: "245000",
      currency: "USD",
    });
    expect(spreadsheetReceipt(built ?? never())).toMatch(
      /cash runs out in 2027-03/u,
    );
  });

  it("never quotes a held-back figure, and names it as held back", () => {
    const secret = "USD 999,999";
    const figures: OwnFinancialFigure[] = [
      ...LEDGERBRIDGE.filter((one) => one.key !== "financial.cash_balance"),
      {
        key: "financial.cash_balance",
        heldBack: true,
        statement: null,
        value: null,
        asOf: null,
      },
    ];
    const built = buildOwnFinancialModelSheet(
      {
        companyId: COMPANY_A,
        companyName: "LedgerBridge",
        figures,
        assumptions: {},
        today: TODAY,
      },
      {},
    );
    const text = JSON.stringify(built);
    expect(text).not.toContain(secret);
    expect(text).toContain("Held back (highly confidential)");
    // No cash, so no cash column.
    expect(
      built?.workbook.sheets[0]?.columns.map((column) => column.key),
    ).not.toContain("cashEnd");
    expect(spreadsheetReceipt(built ?? never())).toMatch(
      /Held back as highly confidential, so not used: cash in the bank/u,
    );
  });

  it("makes nothing when none of the starting figures is known", () => {
    expect(
      buildOwnFinancialModelSheet(
        {
          companyId: COMPANY_A,
          companyName: "LedgerBridge",
          figures: [],
          assumptions: {},
          today: TODAY,
        },
        {},
      ),
    ).toBeNull();
  });

  it("keeps money exact: minor units, no float", () => {
    expect(decimalOfMinor(6_500_050n)).toBe("65000.5");
    expect(decimalOfMinor(-5n)).toBe("-0.05");
    expect(decimalOfMinor(0n)).toBe("0");
  });
});

function never(): never {
  throw new Error("expected a built spreadsheet");
}

function ownPlan(
  companyId: string | null = COMPANY_A,
  actor = actorA,
): PermittedContextPlan {
  const plan = planFor(actor, "OWN_COMPANY_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ...(companyId === null
      ? []
      : [
          {
            kind: "COMPANY_PROFILE" as const,
            sensitivity: "CONFIDENTIAL" as const,
            companyId,
          },
        ]),
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

function setUp(figures: readonly OwnFinancialFigure[] = LEDGERBRIDGE) {
  const filed: { title: string; content: QArtifactContent }[] = [];
  const read: string[] = [];
  const port: SpreadsheetPort = {
    shownAnswers: () => Promise.resolve([]),
    file: (input) => {
      filed.push({ title: input.title, content: input.content });
      return Promise.resolve({
        artifactId: ARTIFACT,
        type: "SPREADSHEET",
        status: "READY",
        title: input.title,
        currentVersion: 1,
      });
    },
    today: () => TODAY,
    ownFinancials: (_actor, companyId) => {
      read.push(companyId);
      return Promise.resolve(figures);
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createMakeSpreadsheetTool(fakePorts(), port),
    ]),
  });
  const run = (
    args: Record<string, unknown>,
    plan = ownPlan(),
    actor = actorA,
  ) =>
    executor.execute(
      { callId: "c-1", name: "make_spreadsheet", arguments: args },
      contextFor(actor, plan),
    );
  return { run, filed, read };
}

describe("make_spreadsheet OWN_FINANCIAL_MODEL", () => {
  it("files the founder's own model from their own figures, with Capital Q's receipt", async () => {
    const { run, filed, read } = setUp();
    const outcome = await run({
      source: "OWN_FINANCIAL_MODEL",
      assumptions: { revenueGrowthPercentPerMonth: 5 },
    });
    expect(outcome.result.ok).toBe(true);
    expect(read).toEqual([COMPANY_A]);
    expect(filed[0]?.title).toBe("Alpha Robotics: 12-month financial model");
    expect(filed[0]?.content.workbook?.sheets.map((s) => s.name)).toEqual([
      "Model",
      "Assumptions",
    ]);
    const data = (outcome.result as { data: { says?: string } }).data;
    expect(data.says).toMatch(/my projection/u);
    expect(data.says).not.toMatch(/nothing of that kind/u);
  });

  it("is only for their own company: another organisation's company is refused and nothing is read", async () => {
    const { run, read, filed } = setUp();
    const outcome = await run(
      { source: "OWN_FINANCIAL_MODEL" },
      ownPlan(COMPANY_B_NETWORK),
    );
    expect(outcome.result.ok).toBe(false);
    expect(read).toHaveLength(0);
    expect(filed).toHaveLength(0);
  });

  it("is refused with no company of theirs in the plan, and to another person", async () => {
    const { run, read } = setUp();
    expect(
      (await run({ source: "OWN_FINANCIAL_MODEL" }, ownPlan(null))).result.ok,
    ).toBe(false);
    expect(
      (
        await run(
          { source: "OWN_FINANCIAL_MODEL" },
          ownPlan(COMPANY_A, actorA),
          actorB,
        )
      ).result.ok,
    ).toBe(false);
    expect(read).toHaveLength(0);
  });

  it("says which starting figures to tell Q when none is known, never 'nothing on your record'", async () => {
    const { run, filed } = setUp([
      {
        key: "financial.burn_rate",
        heldBack: true,
        statement: null,
        value: null,
        asOf: null,
      },
    ]);
    const outcome = await run({ source: "OWN_FINANCIAL_MODEL" });
    const data = (outcome.result as { data: { status: string; says: string } })
      .data;
    expect(data.status).toBe("NOTHING_TO_PUT_IN_IT");
    expect(data.says).toMatch(
      /monthly revenue, monthly net burn, cash in the bank/u,
    );
    expect(data.says).toMatch(
      /monthly net burn earlier, but it is stored as highly confidential/u,
    );
    expect(filed).toHaveLength(0);
  });

  it("refuses assumptions on any other source", async () => {
    const { run } = setUp();
    const outcome = await run({
      source: "PIPELINE",
      assumptions: { revenueGrowthPercentPerMonth: 5 },
    });
    expect(outcome.result.ok).toBe(false);
  });
});
