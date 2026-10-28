/**
 * FINANCIAL_MEASURES v1 (owner decision 2026-10-28): the closed vocabulary
 * of figures Capital Q reads, locally and without a model, out of a
 * founder's highly confidential financial documents (management accounts,
 * a financial model).
 *
 * This is reference data for parsing a document's own table labels and row
 * headers, never a reading of anybody's words: a label either is one of the
 * synonyms below (after the normalisation in `normaliseLabel`) or it is not
 * a measure. There is no fuzzy match and no model. A label the table does
 * not hold is not guessed at; it is simply not offered (precision over
 * recall), and every addition here is a new version.
 *
 * Cadence is how a figure relates to its period:
 *   MONTHLY        a monthly figure ("MRR"): read only for a month
 *   ANNUAL         an annual figure ("ARR", "annualised MRR"): any period,
 *                  as of that period
 *   BY_PERIOD      the label alone does not say ("Revenue"): a month's
 *                  column makes it monthly revenue, a year's annual revenue,
 *                  and a quarter's makes it nothing this table holds
 *   POINT_IN_TIME  a balance or a count ("Cash", "Headcount"): as of the
 *                  period's end
 *   RATE           a rate or ratio for the period ("Gross margin", "CAC")
 */

export const FINANCIAL_MEASURES_VERSION = "FINANCIAL_MEASURES_v1" as const;

export const FINANCIAL_MEASURE_KEYS = [
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
] as const;
export type FinancialMeasureKey = (typeof FINANCIAL_MEASURE_KEYS)[number];

export type MeasureUnit = "MONEY" | "PERCENT" | "MONTHS" | "COUNT";
export type MeasureCadence = "MONTHLY" | "ANNUAL" | "POINT_IN_TIME" | "RATE";

export type FinancialMeasure = {
  readonly key: FinancialMeasureKey;
  readonly unit: MeasureUnit;
  readonly cadence: MeasureCadence;
  /** Human words for the founder ("monthly revenue"). */
  readonly label: string;
  /** Normalised label synonyms that name exactly this measure. */
  readonly synonyms: readonly string[];
  /** Inclusive plausible range for a PERCENT or MONTHS value. */
  readonly range?: { readonly min: number; readonly max: number };
};

export const FINANCIAL_MEASURES: readonly FinancialMeasure[] = [
  {
    key: "monthly_revenue",
    unit: "MONEY",
    cadence: "MONTHLY",
    label: "monthly revenue",
    synonyms: [
      "mrr",
      "monthly recurring revenue",
      "monthly revenue",
      "revenue per month",
      "recognised mrr",
      "recognized mrr",
      "total mrr",
      "net mrr",
    ],
  },
  {
    key: "annual_revenue",
    unit: "MONEY",
    cadence: "ANNUAL",
    label: "annual revenue",
    synonyms: [
      "arr",
      "annual recurring revenue",
      "annual revenue",
      "annualised mrr",
      "annualized mrr",
      "annualised revenue",
      "annualized revenue",
      "annualised run rate",
      "annualized run rate",
      "annual run rate",
      "revenue run rate",
      "run rate revenue",
      "arr run rate",
    ],
  },
  {
    key: "gross_margin",
    unit: "PERCENT",
    cadence: "RATE",
    label: "gross margin",
    synonyms: [
      "gross margin",
      "gross margin %",
      "gross margin percent",
      "gm %",
    ],
    range: { min: -100, max: 100 },
  },
  {
    key: "net_burn",
    unit: "MONEY",
    cadence: "MONTHLY",
    label: "monthly net burn",
    synonyms: [
      "net burn",
      "net burn rate",
      "monthly net burn",
      "monthly burn",
      "burn",
      "burn rate",
      "net cash burn",
      "cash burn",
      "monthly cash burn",
    ],
  },
  {
    key: "cash_balance",
    unit: "MONEY",
    cadence: "POINT_IN_TIME",
    label: "cash in the bank",
    synonyms: [
      "cash",
      "cash balance",
      "cash in bank",
      "cash at bank",
      "cash on hand",
      "closing cash",
      "closing cash balance",
      "ending cash",
      "ending cash balance",
      "cash and cash equivalents",
      "bank balance",
    ],
  },
  {
    key: "runway_months",
    unit: "MONTHS",
    cadence: "POINT_IN_TIME",
    label: "runway",
    synonyms: [
      "runway",
      "runway months",
      "months of runway",
      "cash runway",
      "runway in months",
    ],
    range: { min: 0, max: 240 },
  },
  {
    key: "paying_customers",
    unit: "COUNT",
    cadence: "POINT_IN_TIME",
    label: "paying customers",
    synonyms: [
      "paying customers",
      "customers",
      "active customers",
      "active paying customers",
      "number of customers",
      "customer count",
      "paying merchants",
    ],
  },
  {
    key: "headcount",
    unit: "COUNT",
    cadence: "POINT_IN_TIME",
    label: "headcount",
    synonyms: [
      "headcount",
      "employees",
      "number of employees",
      "full time employees",
      "fte",
      "ftes",
      "team size",
      "staff",
    ],
  },
  {
    key: "cac",
    unit: "MONEY",
    cadence: "RATE",
    label: "customer acquisition cost",
    synonyms: ["cac", "customer acquisition cost", "blended cac"],
  },
  {
    key: "churn",
    unit: "PERCENT",
    cadence: "RATE",
    label: "customer churn",
    synonyms: [
      "churn",
      "churn rate",
      "monthly churn",
      "customer churn",
      "logo churn",
    ],
    range: { min: 0, max: 100 },
  },
];

/**
 * Labels the document leaves to its period ("Revenue" in a column headed
 * "Sep 2026" is that month's revenue). A month makes it monthly revenue, a
 * year annual revenue; a quarter is not a measure here and is not offered.
 */
export const PERIOD_REVENUE_SYNONYMS: readonly string[] = [
  "revenue",
  "revenues",
  "total revenue",
  "net revenue",
  "recognised revenue",
  "recognized revenue",
  "sales",
  "net sales",
  "turnover",
];

/**
 * Column qualifiers. A column headed "Budget", "Forecast" or "Variance"
 * holds no actual figure; "Actual" marks the one that does. Year-to-date
 * columns are a sum, never a month's figure.
 */
export const NON_ACTUAL_QUALIFIERS: readonly string[] = [
  "budget",
  "bud",
  "forecast",
  "fcst",
  "fc",
  "plan",
  "planned",
  "projection",
  "projected",
  "target",
  "variance",
  "var",
  "ytd",
  "year to date",
  "prior year",
  "py",
  "change",
  "growth",
  "mom",
  "yoy",
];
export const ACTUAL_QUALIFIERS: readonly string[] = [
  "actual",
  "actuals",
  "act",
];

/** Words a document uses to declare its figures' currency for every table. */
export const CURRENCY_DECLARATIONS: readonly string[] = [
  "all figures in",
  "all amounts in",
  "all figures are in",
  "all amounts are in",
  "amounts in",
  "figures in",
  "currency",
  "reporting currency",
  "presented in",
];

/**
 * Scale markers, as whole tokens of a caption, a header or a row label
 * (brackets and currency symbols taken off): "USD '000", "($k)", "in
 * thousands". Never read from a figure's own cell, which states its scale
 * itself ("$51K").
 */
export const THOUSANDS_MARKERS: readonly string[] = [
  "'000",
  "000",
  "000s",
  "000's",
  "thousand",
  "thousands",
  "k",
];
export const MILLIONS_MARKERS: readonly string[] = [
  "millions",
  "million",
  "mn",
  "mio",
  "m",
];

/** Currency words a caption, header or label may state, with ISO codes. */
export const CURRENCY_HINTS: readonly (readonly [
  token: string,
  code: string,
  certain: boolean,
])[] = [
  ["us$", "USD", true],
  ["$", "USD", false],
  ["₦", "NGN", true],
  ["£", "GBP", true],
  ["€", "EUR", true],
  ["ksh", "KES", true],
  ["kshs", "KES", true],
  ["gh₵", "GHS", true],
  ["₵", "GHS", true],
  ["₹", "INR", true],
  ["usd", "USD", true],
  ["eur", "EUR", true],
  ["gbp", "GBP", true],
  ["ngn", "NGN", true],
  ["kes", "KES", true],
  ["zar", "ZAR", true],
  ["aed", "AED", true],
  ["inr", "INR", true],
  ["sgd", "SGD", true],
  ["ghs", "GHS", true],
  ["egp", "EGP", true],
  ["cad", "CAD", true],
  ["aud", "AUD", true],
];

/**
 * A table label in comparable form: lower case, ASCII apostrophes, bracketed
 * qualifiers (a currency, a unit) and trailing punctuation removed, words
 * single-spaced. "MRR (USD)" and "M.R.R.:" are not the same text; the first
 * normalises to "mrr" and the second does not, on purpose.
 */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[’`]/gu, "'")
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, " ")
    .replace(/[-–—_/]+/gu, " ")
    .replace(/[:*•·]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const BY_SYNONYM: ReadonlyMap<string, FinancialMeasure> = new Map(
  FINANCIAL_MEASURES.flatMap((measure) =>
    measure.synonyms.map((synonym) => [synonym, measure] as const),
  ),
);

export type LabelMatch =
  | { readonly kind: "MEASURE"; readonly measure: FinancialMeasure }
  | { readonly kind: "PERIOD_REVENUE" };

/** The measure a table label names exactly, or null. */
export function measureForLabel(label: string): LabelMatch | null {
  const normalised = normaliseLabel(label);
  if (normalised.length === 0) return null;
  const measure = BY_SYNONYM.get(normalised);
  if (measure !== undefined) return { kind: "MEASURE", measure };
  if (PERIOD_REVENUE_SYNONYMS.includes(normalised)) {
    return { kind: "PERIOD_REVENUE" };
  }
  return null;
}

export function measureByKey(key: FinancialMeasureKey): FinancialMeasure {
  const found = FINANCIAL_MEASURES.find((measure) => measure.key === key);
  if (found === undefined) throw new Error(`unknown measure ${key}`);
  return found;
}
