import type { QSheetCell, QSheetColumn } from "@capital-q/contracts";

import {
  andList,
  finish,
  sheet,
  sheetName,
  text,
  type BuiltSpreadsheet,
  type SheetChoice,
} from "./spreadsheet-build.js";

/**
 * Q-page sweep 2026-10-29 (F06): "Build my 12-month financial model as a
 * spreadsheet". The only sources were published claims and things already
 * shown, so the founder was told "nothing of that kind is on your record"
 * while Q then quoted the cash, burn and revenue they had told it.
 *
 * Their own model, from their own figures, under their own access:
 *
 *   - the base figures are what they told Q about their company's finances
 *     (USER_CLAIM, SELF_REPORTED), quoted as theirs; a figure stored above
 *     CONFIDENTIAL reaches this builder without its words or value and is
 *     named as held back, never quoted (plan-figures.ts' rule);
 *   - the months are Q's projection (truth class ESTIMATE), computed by
 *     code from those figures and the assumptions on their own sheet, and
 *     never presented as the founder's data;
 *   - a base figure that is not known stays blank and is asked for; no
 *     figure is invented, and a growth rate nobody gave is not assumed:
 *     the line is held flat and that is said.
 *
 * Arithmetic is exact: money in minor units as integers (BigInt), rates
 * in basis points, rounded half away from zero each month. Money is never
 * a float.
 */

/** One of their own financial figures, as the composition read it. */
export type OwnFinancialFigure = {
  /** "financial.monthly_revenue", "financial.burn_rate", ... */
  readonly key: string;
  /**
   * True when stored above CONFIDENTIAL: `statement` and `value` are then
   * absent by construction (the read never returns them).
   */
  readonly heldBack: boolean;
  readonly statement: string | null;
  readonly value: Readonly<Record<string, unknown>> | null;
  readonly asOf: string | null;
};

/** What the turn assumed, if anything; each is Q's (or their) assumption. */
export type ModelAssumptions = {
  /** Percent per month, e.g. 5 or -2.5; absent: held flat. */
  readonly revenueGrowthPercentPerMonth?: number | undefined;
  readonly costGrowthPercentPerMonth?: number | undefined;
  /** Why these rates, in a sentence (Q's reasoning or their words). */
  readonly basis?: string | undefined;
  /** True when the person gave the rates themselves. */
  readonly theirs?: boolean | undefined;
};

export const MODEL_MONTHS_DEFAULT = 12;

const MEASURES = {
  revenue: "financial.monthly_revenue",
  burn: "financial.burn_rate",
  cash: "financial.cash_balance",
  margin: "financial.gross_margin",
  trend: "financial.revenue_trend",
} as const;

const WORDS: Readonly<Record<string, string>> = {
  [MEASURES.revenue]: "monthly revenue",
  [MEASURES.burn]: "monthly net burn",
  [MEASURES.cash]: "cash in the bank",
  [MEASURES.margin]: "gross margin",
};

type Amount = { readonly minor: bigint; readonly currency: string };

const DECIMAL = /^(-?)(\d{1,15})(?:\.(\d{1,2}))?$/u;

/** "65000" / "65000.5" -> minor units; null when not an exact decimal. */
function minorOf(amount: unknown): bigint | null {
  if (typeof amount !== "string") return null;
  const match = DECIMAL.exec(amount.trim());
  if (match === null) return null;
  const [, sign = "", whole = "0", fraction = ""] = match;
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign === "-" ? -minor : minor;
}

/** Minor units -> "65000" or "65000.5" (exact). */
export function decimalOfMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const fraction =
    cents === 0n
      ? ""
      : `.${cents.toString().padStart(2, "0").replace(/0$/u, "")}`;
  return `${negative && abs !== 0n ? "-" : ""}${whole.toString()}${fraction}`;
}

/** value * bp / 10000, rounded half away from zero. */
function scale(value: bigint, bp: bigint): bigint {
  const product = value * bp;
  const quotient = product / 10_000n;
  const remainder = product % 10_000n;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < 10_000n) return quotient;
  return product < 0n ? quotient - 1n : quotient + 1n;
}

/** A percent per month as basis points; out of bounds or absent: null. */
function basisPoints(percent: number | undefined): bigint | null {
  if (percent === undefined || !Number.isFinite(percent)) return null;
  if (percent < -50 || percent > 100) return null;
  return BigInt(Math.round(percent * 100));
}

const percentText = (bp: bigint): string => decimalOfMinor(bp);

function moneyOf(figure: OwnFinancialFigure | undefined): Amount | null {
  if (figure === undefined || figure.heldBack || figure.value === null) {
    return null;
  }
  if (figure.value["kind"] !== "MONEY") return null;
  const minor = minorOf(figure.value["amount"]);
  const currency = figure.value["currency"];
  return minor !== null &&
    typeof currency === "string" &&
    /^[A-Z]{3}$/u.test(currency)
    ? { minor, currency }
    : null;
}

function marginOf(figure: OwnFinancialFigure | undefined): bigint | null {
  if (figure === undefined || figure.heldBack || figure.value === null) {
    return null;
  }
  const kind = figure.value["kind"];
  if (kind !== "PERCENTAGE" && kind !== "PERCENT") return null;
  const raw = figure.value["value"];
  const minor = minorOf(typeof raw === "number" ? String(raw) : raw);
  // A gross margin is between -100 % and 100 %.
  return minor !== null && minor >= -10_000n && minor <= 10_000n ? minor : null;
}

const cell = (amount: bigint | null, currency: string): QSheetCell =>
  amount === null ? null : { amount: decimalOfMinor(amount), currency };

/** The first day of each of the `count` months after `today`. */
function monthsAfter(today: string, count: number): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Array.from({ length: count }, (_, at) => {
    const index = month + at; // month is 1-based: this is the next month.
    const y = year + Math.floor(index / 12);
    const m = (index % 12) + 1;
    return `${String(y)}-${String(m).padStart(2, "0")}-01`;
  });
}

const MODEL_COLUMNS: readonly QSheetColumn[] = [
  { key: "month", label: "Month", type: "date" },
  { key: "revenue", label: "Revenue", type: "money" },
  { key: "grossProfit", label: "Gross profit", type: "money" },
  { key: "costs", label: "Costs (revenue + net burn)", type: "money" },
  { key: "netBurn", label: "Net burn (negative: cash in)", type: "money" },
  { key: "cashEnd", label: "Cash at month end", type: "money" },
];

const ASSUMPTION_COLUMNS: readonly QSheetColumn[] = [
  { key: "item", label: "Item", type: "text" },
  { key: "amount", label: "Amount", type: "money" },
  { key: "percent", label: "Percent", type: "percent" },
  { key: "standing", label: "Standing", type: "text" },
  { key: "basis", label: "Basis", type: "text" },
];

const YOURS = "Your figure (you told Q; self-reported)";
const NOT_KNOWN = "Not known";
const HELD_BACK = "Held back (highly confidential)";

/** plan-figures.ts heldBackToldStatement's words, for the sheet. */
function heldBackLine(measure: string): string {
  return `You told Q your ${measure} earlier; it is stored as highly confidential, so Q does not use it. Tell Q again and Q will use it as yours.`;
}

export type OwnFinancialModelInput = {
  readonly companyId: string;
  readonly companyName: string;
  readonly figures: readonly OwnFinancialFigure[];
  readonly assumptions: ModelAssumptions;
  readonly months?: number | undefined;
  readonly today: string;
};

/**
 * Their own financial model. Null when none of the figures a model starts
 * from (monthly revenue, net burn, cash) is usable: the caller then says
 * which to tell Q, and makes nothing.
 */
export function buildOwnFinancialModelSheet(
  input: OwnFinancialModelInput,
  choice: SheetChoice,
): BuiltSpreadsheet | null {
  const newest = new Map<string, OwnFinancialFigure>();
  for (const figure of input.figures) {
    if (!newest.has(figure.key)) newest.set(figure.key, figure);
  }
  const revenue = moneyOf(newest.get(MEASURES.revenue));
  const burn = moneyOf(newest.get(MEASURES.burn));
  const cash = moneyOf(newest.get(MEASURES.cash));
  const margin = marginOf(newest.get(MEASURES.margin));
  if (revenue === null && burn === null && cash === null) return null;

  const currencies = new Set(
    [revenue, burn, cash].flatMap((one) =>
      one === null ? [] : [one.currency],
    ),
  );
  // Pounds are not added to dollars: with more than one currency, only the
  // lines that need no conversion are projected, and that is said.
  const oneCurrency = currencies.size === 1;
  const currency = [...currencies][0] ?? "USD";

  const revenueBp = basisPoints(input.assumptions.revenueGrowthPercentPerMonth);
  const costBp = basisPoints(input.assumptions.costGrowthPercentPerMonth);
  const count = Math.min(Math.max(input.months ?? MODEL_MONTHS_DEFAULT, 1), 36);
  const months = monthsAfter(input.today, count);

  // Costs are only known where revenue and net burn both are, in one currency.
  const costs0 =
    revenue !== null && burn !== null && oneCurrency
      ? revenue.minor + burn.minor
      : null;
  let rev = revenue?.minor ?? null;
  let cost = costs0;
  let cashLeft = cash !== null && oneCurrency ? cash.minor : null;
  // Set inside the month loop's callback, so held in an object (a
  // `let` would read as always null to the type checker after it).
  const outOfCash: { month: string | null } = { month: null };
  const rows = months.map((month): QSheetCell[] => {
    if (rev !== null) rev += scale(rev, revenueBp ?? 0n);
    if (cost !== null) cost += scale(cost, costBp ?? 0n);
    const net =
      cost !== null && rev !== null
        ? cost - rev
        : // Revenue not known: the stated net burn, held as stated.
          burn !== null && revenue === null
          ? burn.minor
          : null;
    if (cashLeft !== null) {
      cashLeft = net === null ? null : cashLeft - net;
      if (cashLeft !== null && cashLeft < 0n && outOfCash.month === null) {
        outOfCash.month = month.slice(0, 7);
      }
    }
    return [
      month,
      revenue === null ? null : cell(rev, revenue.currency),
      rev !== null && margin !== null && revenue !== null
        ? cell(scale(rev, margin), revenue.currency)
        : null,
      cell(cost, currency),
      cell(net, burn?.currency ?? currency),
      cell(cashLeft, currency),
    ];
  });
  // Columns nothing could fill are left out, and said under "not known".
  const filled = MODEL_COLUMNS.filter(
    (_, at) => at === 0 || rows.some((row) => row[at] !== null),
  );
  const keep = new Set(filled.map((column) => column.key));
  const modelSheet = sheet(
    sheetName(choice.sheetName, "Model"),
    filled,
    rows.map((row) =>
      row.filter((_, at) => keep.has(MODEL_COLUMNS[at]?.key ?? "")),
    ),
    [],
    // The model keeps every projected column: a narrower choice would drop
    // the line that explains the next.
    {},
  );

  const assumptionRows: QSheetCell[][] = [];
  const unknown: string[] = [];
  const heldBack: string[] = [];
  const base = (key: string, amount: Amount | null) => {
    const figure = newest.get(key);
    const measure = WORDS[key] ?? key;
    const label = `Starting ${measure}`;
    if (figure?.heldBack === true) {
      heldBack.push(measure);
      assumptionRows.push([
        label,
        null,
        null,
        HELD_BACK,
        heldBackLine(measure),
      ]);
      return;
    }
    if (amount === null) {
      unknown.push(measure);
      assumptionRows.push([
        label,
        null,
        null,
        NOT_KNOWN,
        `Not on your record. Tell Q your ${measure} and Q will fill the model.`,
      ]);
      return;
    }
    assumptionRows.push([
      label,
      cell(amount.minor, amount.currency),
      null,
      YOURS,
      text(
        `${figure?.statement ?? ""}${figure?.asOf === null || figure?.asOf === undefined ? "" : ` (recorded ${figure.asOf.slice(0, 10)})`}`,
      ),
    ]);
  };
  base(MEASURES.revenue, revenue);
  base(MEASURES.burn, burn);
  base(MEASURES.cash, cash);
  const marginFigure = newest.get(MEASURES.margin);
  if (marginFigure?.heldBack === true) {
    heldBack.push("gross margin");
    assumptionRows.push([
      "Gross margin",
      null,
      null,
      HELD_BACK,
      heldBackLine("gross margin"),
    ]);
  } else if (margin === null) {
    unknown.push("gross margin");
    assumptionRows.push([
      "Gross margin",
      null,
      null,
      NOT_KNOWN,
      "Not on your record. Tell Q your gross margin and Q will add gross profit.",
    ]);
  } else {
    assumptionRows.push([
      "Gross margin",
      null,
      percentText(margin),
      YOURS,
      text(marginFigure?.statement ?? null),
    ]);
  }
  const trend = newest.get(MEASURES.trend);
  if (trend !== undefined && !trend.heldBack && trend.statement !== null) {
    assumptionRows.push([
      "Revenue trend",
      null,
      null,
      YOURS,
      text(trend.statement),
    ]);
  }
  const theirs = input.assumptions.theirs === true;
  const rateStanding = theirs ? "Your assumption" : "Q's assumption";
  const basis = input.assumptions.basis?.trim();
  const rateRow = (
    label: string,
    bp: bigint | null,
    what: string,
  ): QSheetCell[] =>
    bp === null
      ? [
          label,
          null,
          "0",
          "Held flat (no rate given)",
          `No growth rate was given, so ${what} is held flat. Tell Q the monthly growth you expect and Q will rebuild the model.`,
        ]
      : [
          label,
          null,
          percentText(bp),
          rateStanding,
          text(
            basis === undefined || basis.length === 0
              ? `${rateStanding}, applied every month.`
              : basis,
          ),
        ];
  if (revenue !== null) {
    assumptionRows.push(
      rateRow("Revenue growth per month", revenueBp, "revenue"),
    );
  }
  if (costs0 !== null) {
    assumptionRows.push(rateRow("Cost growth per month", costBp, "costs"));
  } else if (burn !== null && revenue === null) {
    assumptionRows.push([
      "Net burn",
      null,
      null,
      "Held as stated",
      "Revenue is not known, so costs cannot be separated from net burn: net burn is held at your stated figure each month.",
    ]);
  }
  if (!oneCurrency) {
    assumptionRows.push([
      "Currencies",
      null,
      null,
      NOT_KNOWN,
      "Your figures are in more than one currency; Q does not convert them, so lines that would add them together are left out.",
    ]);
  }
  assumptionRows.push([
    "Projection",
    null,
    null,
    "Q's projection (an estimate)",
    `${String(count)} months from ${months[0]?.slice(0, 7) ?? ""}. Each month applies the rates above to the month before; cash at month end is the month before less that month's net burn. These are not your figures.`,
  ]);
  const assumptionsSheet = sheet(
    "Assumptions",
    ASSUMPTION_COLUMNS,
    assumptionRows,
    [],
    {},
  );

  const asks = [...unknown];
  const gaps = [
    ...asks.map(
      (measure) =>
        `Your ${measure} is not on your record, so the model leaves it out. Tell Q your ${measure} and Q will fill it in.`,
    ),
    ...heldBack.map(heldBackLine),
  ];
  const ran =
    outOfCash.month === null
      ? ""
      : ` On these assumptions cash runs out in ${outOfCash.month}.`;
  const noteParts = [
    `The ${String(count)} months are my projection from the figures you told me, not your figures; every assumption is on the Assumptions sheet.${ran}`,
    asks.length === 0
      ? ""
      : `Not on your record: ${andList(asks)}. Tell me ${asks.length === 1 ? "it" : "them"} and I'll fill the model.`,
    heldBack.length === 0
      ? ""
      : `Held back as highly confidential, so not used: ${andList(heldBack)}. Tell me again and I'll use ${heldBack.length === 1 ? "it" : "them"}.`,
  ].filter((part) => part.length > 0);

  return finish({
    title: `${input.companyName}: ${String(count)}-month financial model`,
    summary: `A ${String(count)}-month projection Q made for ${input.companyName} from the figures you told Q. The months are Q's projection (an estimate), not your figures; the starting figures are your own claims (self-reported), and every assumption is stated on the Assumptions sheet.`,
    sheets: [modelSheet, assumptionsSheet],
    sources: [
      {
        sheet: modelSheet.name,
        columns: modelSheet.columns.map((column) => column.label),
        from: "Q's projection from the figures you told Q and the rates on the Assumptions sheet; an estimate, not your data",
        truthClass: "ESTIMATE",
        refs: [
          {
            kind: "COMPANY",
            id: input.companyId,
            label: input.companyName.slice(0, 200),
          },
        ],
      },
      {
        sheet: assumptionsSheet.name,
        columns: assumptionsSheet.columns.map((column) => column.label),
        from: "What you told Q about your company's finances (self-reported), and the assumptions stated row by row",
        // Each row says its own standing: their claim or Q's assumption.
        truthClass: null,
        refs: [
          {
            kind: "COMPANY",
            id: input.companyId,
            label: input.companyName.slice(0, 200),
          },
        ],
      },
    ],
    today: input.today,
    gaps,
    provenance: `Prepared by Q on ${input.today} from what you told Q about your finances. The months are Q's projection, not your data; a blank cell is not known, never zero.`,
    note: noteParts.join(" "),
  });
}

/**
 * Nothing to start a model from: which figures to tell Q, and which they
 * told that are held back. Capital Q's own line; nothing is made.
 */
export function ownModelNothingLine(
  figures: readonly OwnFinancialFigure[],
): string {
  const held = [
    ...new Set(
      figures
        .filter((figure) => figure.heldBack && WORDS[figure.key] !== undefined)
        .map((figure) => WORDS[figure.key] ?? ""),
    ),
  ];
  const line =
    "I haven't made the model: none of the figures it starts from (monthly revenue, monthly net burn, cash in the bank) is on your record yet. Tell me them and I'll build it.";
  return held.length === 0
    ? line
    : `${line} You told me your ${andList(held)} earlier, but ${held.length === 1 ? "it is" : "they are"} stored as highly confidential, so I don't use ${held.length === 1 ? "it" : "them"} until you tell me again.`;
}
