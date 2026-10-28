import type { LocalFigureCandidate, LocalFigureValue } from "./extract.js";
import {
  FINANCIAL_MEASURE_KEYS,
  FINANCIAL_MEASURES_VERSION,
  type FinancialMeasureKey,
} from "./measures.js";
import {
  describePeriod,
  type FigurePeriod,
  type PeriodGranularity,
} from "./period.js";

/**
 * Where an offered figure came from, carried on the onboarding suggestion
 * itself (no new table): bounded source refs any reader can decode, and a
 * rationale the founder reads beside Keep / Change / Not this.
 *
 *   EVIDENCE_DOCUMENT          the document
 *   EVIDENCE_DOCUMENT_VERSION  the exact version it was read from
 *   LOCAL_FIGURE               "FINANCIAL_MEASURES_v1|monthly_revenue|MONTH:2026-09|2026-09-30|USD|HIGH"
 *   LOCAL_FIGURE_CELL          "p1|t1|r2|c3" (page or slide, table, row, column)
 *
 * The quote is in the rationale for the founder's eyes only: a suggestion
 * carrying LOCAL_FIGURE is never put to a model (onboarding
 * isLocalFigureProposal), because until the founder confirms it, it is the
 * document's content, and the document is highly confidential.
 */

/**
 * The onboarding runtime's own marker (onboarding LOCAL_FIGURE_SOURCE, kept
 * equal by test): this module imports nothing at runtime, so the browser
 * can read a suggestion's provenance without the server packages.
 */
export const LOCAL_FIGURE_SOURCE = "LOCAL_FIGURE" as const;
export const LOCAL_FIGURE_CELL_SOURCE = "LOCAL_FIGURE_CELL" as const;
/** The period in the founder's terms, for the browser. */
export const describeFigurePeriod = describePeriod;

export type LocalFigureProvenance = {
  readonly measuresVersion: string;
  readonly measure: FinancialMeasureKey;
  readonly period: FigurePeriod;
  /** The stated currency for a money figure; null otherwise. */
  readonly currency: string | null;
  readonly confidence: "HIGH" | "MEDIUM";
  readonly documentId: string | null;
  readonly documentVersionId: string | null;
  /** "page 1, table 1, row 2" in the founder's terms; null when unknown. */
  readonly where: string | null;
};

type Ref = { readonly sourceType: string; readonly sourceId: string };

function currencyOf(value: LocalFigureValue): string {
  return value.kind === "MONEY"
    ? `${value.currency}${value.currencyCertain ? "" : "?"}`
    : "";
}

export function localFigureRefs(
  candidate: LocalFigureCandidate,
  document: { readonly documentId: string; readonly documentVersionId: string },
): readonly Ref[] {
  const { locator, period } = candidate;
  const position =
    locator.page !== null
      ? `p${String(locator.page)}`
      : locator.slide !== null
        ? `s${String(locator.slide)}`
        : "p0";
  return [
    { sourceType: "EVIDENCE_DOCUMENT", sourceId: document.documentId },
    {
      sourceType: "EVIDENCE_DOCUMENT_VERSION",
      sourceId: document.documentVersionId,
    },
    {
      sourceType: LOCAL_FIGURE_SOURCE,
      sourceId: [
        candidate.measuresVersion,
        candidate.measure,
        `${period.granularity}:${period.key}`,
        period.asOf ?? "",
        currencyOf(candidate.value),
        candidate.confidence,
      ].join("|"),
    },
    {
      sourceType: LOCAL_FIGURE_CELL_SOURCE,
      sourceId: [
        position,
        `t${String(locator.table)}`,
        `r${String(locator.row)}`,
        `c${String(locator.column)}`,
      ].join("|"),
    },
  ];
}

const GRANULARITIES: readonly PeriodGranularity[] = [
  "MONTH",
  "QUARTER",
  "YEAR",
];

function whereOf(cell: string | undefined): string | null {
  if (cell === undefined) return null;
  const [position = "", table = "", row = ""] = cell.split("|");
  const n = (part: string) => Number(part.slice(1));
  const parts: string[] = [];
  if (/^p[1-9]\d*$/u.test(position)) parts.push(`page ${String(n(position))}`);
  if (/^s[1-9]\d*$/u.test(position)) parts.push(`slide ${String(n(position))}`);
  if (/^t[1-9]\d*$/u.test(table)) {
    parts.push(`table ${String(n(table))}`);
    if (/^r[1-9]\d*$/u.test(row)) parts.push(`row ${String(n(row))}`);
  }
  return parts.length === 0 ? null : parts.join(", ");
}

/** The provenance a suggestion's refs carry, or null when it has none. */
export function localFigureOf(
  refs: readonly Ref[],
): LocalFigureProvenance | null {
  const figure = refs.find((ref) => ref.sourceType === LOCAL_FIGURE_SOURCE);
  if (figure === undefined) return null;
  const [
    version = "",
    measure = "",
    period = "",
    asOf = "",
    currency = "",
    confidence = "",
  ] = figure.sourceId.split("|");
  if (version !== FINANCIAL_MEASURES_VERSION) return null;
  if (!(FINANCIAL_MEASURE_KEYS as readonly string[]).includes(measure)) {
    return null;
  }
  const [granularity = "", key = ""] = period.split(":");
  if (!(GRANULARITIES as readonly string[]).includes(granularity)) return null;
  if (!/^\d{4}(?:-\d{2}|-Q[1-4])?$/u.test(key)) return null;
  const code = currency.replace(/\?$/u, "");
  return {
    measuresVersion: version,
    measure: measure as FinancialMeasureKey,
    period: {
      granularity: granularity as PeriodGranularity,
      key,
      asOf: /^\d{4}-\d{2}-\d{2}$/u.test(asOf) ? asOf : null,
      label: key,
    },
    currency: /^[A-Z]{3}$/u.test(code) ? code : null,
    confidence: confidence === "HIGH" ? "HIGH" : "MEDIUM",
    documentId:
      refs.find((ref) => ref.sourceType === "EVIDENCE_DOCUMENT")?.sourceId ??
      null,
    documentVersionId:
      refs.find((ref) => ref.sourceType === "EVIDENCE_DOCUMENT_VERSION")
        ?.sourceId ?? null,
    where: whereOf(
      refs.find((ref) => ref.sourceType === LOCAL_FIGURE_CELL_SOURCE)?.sourceId,
    ),
  };
}

const TYPE_WORDS: Readonly<Record<string, string>> = {
  MANAGEMENT_ACCOUNTS: "management accounts",
  FINANCIAL_MODEL: "financial model",
  FINANCIAL: "financial document",
};

/**
 * What the founder reads beside the figure: the document, where in it, the
 * period, and the cell as written. At most 300 characters (the runtime's
 * bound).
 */
export function localFigureRationale(
  candidate: LocalFigureCandidate,
  document: { readonly title: string; readonly documentType: string },
): string {
  const kind = TYPE_WORDS[document.documentType] ?? "financial document";
  const title = document.title.trim().slice(0, 60);
  const where = whereOf(
    localFigureRefs(candidate, { documentId: "x", documentVersionId: "x" })[3]
      ?.sourceId,
  );
  const quote = candidate.quote.slice(0, 120);
  return `From your ${kind} “${title}”${where === null ? "" : `, ${where}`} (${describePeriod(candidate.period)}): “${quote}”. Read by Capital Q's code; no model saw this document.`.slice(
    0,
    300,
  );
}

const MEASURE_WORDS: Readonly<Record<FinancialMeasureKey, string>> = {
  monthly_revenue: "Monthly revenue",
  annual_revenue: "Annual revenue",
  gross_margin: "Gross margin",
  net_burn: "Monthly net burn",
  cash_balance: "Cash in the bank",
  runway_months: "Runway",
  paying_customers: "Paying customers",
  headcount: "Headcount",
  cac: "Customer acquisition cost",
  churn: "Customer churn",
};

/** The measure's name for the founder ("Monthly revenue"). */
export function localFigureLabel(measure: FinancialMeasureKey): string {
  return MEASURE_WORDS[measure];
}

/** A figure as the founder reads it: "USD 51,000", "62%", "5 months". */
export function formatLocalFigure(
  figure: LocalFigureProvenance,
  value: string,
): string {
  const [whole = "0", fraction] = value.split(".");
  const grouped = `${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
  switch (figure.measure) {
    case "gross_margin":
    case "churn":
      return `${grouped}%`;
    case "runway_months":
      return `${grouped} months`;
    case "paying_customers":
    case "headcount":
      return grouped;
    case "monthly_revenue":
    case "annual_revenue":
    case "net_burn":
    case "cash_balance":
    case "cac":
      return figure.currency === null
        ? grouped
        : `${figure.currency} ${grouped}`;
  }
}
