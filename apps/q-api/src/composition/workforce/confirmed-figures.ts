import {
  describePeriod,
  FINANCIAL_MEASURES,
  measureForLabel,
  parsePeriod,
  periodInText,
  type FigurePeriod,
  type FinancialMeasure,
  type FinancialMeasureKey,
} from "@capital-q/founder-onboarding";
import { parseMoneyAll } from "@capital-q/onboarding";

import type { ClaimStatus } from "./claims.js";

/**
 * Claims vs evidence for the founder's own figures (owner decision
 * 2026-10-28), beside the public-source matcher in claims.ts and with its
 * statuses: each figure the founder confirmed from their highly
 * confidential financial document is set against what their deck states
 * for the same measure, the same period and the same currency.
 *
 * Deterministic, never a model, and neither side is picked: CORROBORATED
 * within rounding, CONTRADICTED beyond it (both shown), UNVERIFIED when the
 * deck states nothing comparable (which is not a mark against it). Only the
 * confirmed claim's value and the deck reading's line are used: the
 * financial document itself is never read here, and never reaches a model.
 */

/**
 * A deck rounds ("$51K" for 51,240); anything beyond rounding is a second
 * figure for the same thing. Tighter than the public-source ratio (15%) on
 * purpose: both sides are the company's own, for the same period.
 */
export const FIGURE_AGREEMENT_RATIO = 1.025;

/** A figure the founder kept (or corrected) from their financial document. */
export type ConfirmedFigure = {
  readonly measure: FinancialMeasureKey;
  readonly period: FigurePeriod;
  readonly value:
    | {
        readonly kind: "MONEY";
        readonly amount: string;
        readonly currency: string;
      }
    | {
        readonly kind: "PERCENT" | "MONTHS" | "COUNT";
        readonly value: string;
      };
  readonly documentId: string | null;
  /** The document's title and where in it, in the founder's terms. */
  readonly source: string;
  readonly confirmation: "KEPT" | "EDITED";
};

/** A figure Q's reading of the founder's deck states (DECK_EXTRACTION). */
export type DeckStatedFigure = {
  readonly section: string;
  readonly label: string;
  readonly value: string | null;
  readonly asOf: string | null;
  readonly pages: readonly number[];
  /** The founder confirmed this reading of their deck. */
  readonly confirmed: boolean;
};

export type FigureRow = {
  readonly status: ClaimStatus;
  readonly measure: FinancialMeasureKey;
  readonly documentId: string | null;
  /** One line, both sides, written by code: what Q may tell the founder. */
  readonly line: string;
};

function shown(value: ConfirmedFigure["value"]): string {
  if (value.kind === "MONEY") {
    const [whole = "0", fraction] = value.amount.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
    return `${value.currency} ${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
  }
  if (value.kind === "PERCENT") return `${value.value}%`;
  if (value.kind === "MONTHS") return `${value.value} months`;
  return value.value;
}

function deckNumber(
  figure: DeckStatedFigure,
  measure: FinancialMeasure,
): { readonly amount: number; readonly currency: string | null } | null {
  if (figure.value === null) return null;
  if (measure.unit === "MONEY") {
    const all = parseMoneyAll(figure.value);
    const [money] = all;
    if (all.length !== 1 || money === undefined) return null;
    return { amount: Number(money.amount), currency: money.currency };
  }
  const numbers = figure.value.match(/\d[\d,]*(?:\.\d+)?/gu) ?? [];
  if (numbers.length !== 1) return null;
  return {
    amount: Number((numbers[0] ?? "").replace(/,/gu, "")),
    currency: null,
  };
}

function sameMeasure(
  label: string,
  period: FigurePeriod | null,
  measure: FinancialMeasureKey,
): boolean {
  const match = measureForLabel(label);
  if (match === null) return false;
  if (match.kind === "MEASURE") return match.measure.key === measure;
  // "Revenue": monthly for a month, annual for a year (the measure table).
  return (
    period !== null &&
    ((period.granularity === "MONTH" && measure === "monthly_revenue") ||
      (period.granularity === "YEAR" && measure === "annual_revenue"))
  );
}

const ORDER: Readonly<Record<ClaimStatus, number>> = {
  CONTRADICTED: 0,
  UNVERIFIED: 1,
  CORROBORATED: 2,
};

export function matchConfirmedFigures(
  confirmed: readonly ConfirmedFigure[],
  deck: readonly DeckStatedFigure[],
): readonly FigureRow[] {
  const rows: FigureRow[] = [];
  for (const figure of confirmed.slice(0, 20)) {
    const measure = FINANCIAL_MEASURES.find((m) => m.key === figure.measure);
    if (measure === undefined) continue;
    const words = `${measure.label.charAt(0).toUpperCase()}${measure.label.slice(1)}, ${describePeriod(figure.period)}`;
    const stated = `${shown(figure.value)} (${figure.confirmation === "EDITED" ? "you corrected it from" : "you confirmed it from"} ${figure.source}; your own stated figure, USER_CLAIM, SELF_REPORTED)`;
    const comparable: { agrees: boolean; deckLine: string }[] = [];
    const elsewhere: string[] = [];
    for (const one of deck) {
      const period =
        one.asOf === null
          ? null
          : (parsePeriod(one.asOf) ?? periodInText(one.asOf));
      if (!sameMeasure(one.label, period, figure.measure)) continue;
      const number = deckNumber(one, measure);
      if (number === null) continue;
      const deckLine = `${one.label}: ${one.value ?? ""} (${one.section.toLowerCase()}${one.asOf === null ? ", undated" : `, as of ${one.asOf}`}${one.pages.length === 0 ? "" : `, page ${one.pages.join(", ")}`}${one.confirmed ? "" : "; Q's reading of your deck, not yet confirmed by you"})`;
      // A different period, or a different or unstated currency, is a
      // different figure: shown, never called a contradiction.
      if (
        period === null ||
        period.key !== figure.period.key ||
        (figure.value.kind === "MONEY" &&
          number.currency !== figure.value.currency)
      ) {
        elsewhere.push(deckLine);
        continue;
      }
      const mine = Number(
        figure.value.kind === "MONEY" ? figure.value.amount : figure.value.value,
      );
      const high = Math.max(mine, number.amount);
      const low = Math.min(mine, number.amount);
      comparable.push({
        agrees: low > 0 && high / low <= FIGURE_AGREEMENT_RATIO,
        deckLine,
      });
    }
    const contradicting = comparable.filter((one) => !one.agrees);
    const supporting = comparable.filter((one) => one.agrees);
    const status: ClaimStatus =
      contradicting.length > 0
        ? "CONTRADICTED"
        : supporting.length > 0
          ? "CORROBORATED"
          : "UNVERIFIED";
    const against =
      comparable.length > 0
        ? `Your deck: ${[...contradicting, ...supporting]
            .slice(0, 2)
            .map((one) => one.deckLine)
            .join(" / ")}`
        : elsewhere.length > 0
          ? `Your deck states it for another period or currency, so it was not compared: ${elsewhere[0] ?? ""}`
          : "Your deck states no comparable figure.";
    rows.push({
      status,
      measure: figure.measure,
      documentId: figure.documentId,
      line: `${status} | ${words} | Your figure: ${stated} | ${against}${status === "CONTRADICTED" ? " | Both stay on record; neither is picked." : ""}`.slice(
        0,
        600,
      ),
    });
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) => ORDER[a.row.status] - ORDER[b.row.status] || a.index - b.index,
    )
    .map((entry) => entry.row);
}
