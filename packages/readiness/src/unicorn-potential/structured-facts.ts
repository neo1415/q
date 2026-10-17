import type { InvestabilityClaimInput } from "../investability/inputs.js";
import type { PillarId } from "./method-v1.js";
export type StructuredSignal = {
  readonly pillar: PillarId;
  readonly criterion: "A" | "B";
  readonly grade: number;
  readonly at: string | null;
  readonly rule: string;
};
export function metricDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(20\d\d)-(0[1-9]|1[0-2])(?:-([0-2]\d|3[01]))?$/u.exec(value);
  if (match === null) return null;
  const date = `${match[1]}-${match[2]}-${match[3] ?? "01"}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString() === date
    ? date
    : null;
}
function number(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value))
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const MONEY_KEYS = new Set([
  "financial.arr",
  "financial.contracted_arr",
  "financial.monthly_revenue",
  "financial.revenue",
  "financial.revenue_2025",
  "financial.revenue_to_date",
  "financial.annualised_revenue",
  "financial.pilot_revenue",
]);
const PAYING_KEYS = new Set([
  "customers.paying_accounts",
  "customers.employers",
]);
/** Closed canonical keys + measured values. Other keys never gain a grade from their names. */
export function structuredSignals(
  claim: InvestabilityClaimInput,
): readonly StructuredSignal[] {
  const v = claim.structuredValue;
  if (v === undefined || v === null) return [];
  if (
    v.forecast === true ||
    v.isForecast === true ||
    v.actual === false ||
    v.kind === "FORECAST" ||
    v.basis === "FORECAST" ||
    /\b(forecast|projection|projected|target|planned)\b/iu.test(claim.statement)
  )
    return [];
  const key = claim.claimKey.toLowerCase();
  if (claim.truthClass === "ESTIMATE" && !key.startsWith("market.")) return [];
  const at =
    metricDate(v.asOf) ?? metricDate(v.periodEnd) ?? metricDate(v.period);
  const out: StructuredSignal[] = [];
  const emit = (
    pillar: PillarId,
    criterion: "A" | "B",
    grade: number,
    rule: string,
  ) =>
    out.push({
      pillar,
      criterion,
      grade,
      at,
      rule: `structured.${key}.${rule}; measured ${String(v.amount ?? v.value)}${typeof v.currency === "string" ? ` ${v.currency}` : ""}; period ${at ?? "unknown"}`,
    });
  if (v.kind === "MONEY") {
    const n = number(v.amount);
    if (
      n === null ||
      n < 0 ||
      typeof v.currency !== "string" ||
      !CURRENCIES.has(v.currency)
    )
      return [];
    if (MONEY_KEYS.has(key) && n > 0) {
      emit(
        "P3",
        "A",
        3,
        key === "financial.contracted_arr"
          ? "contracted_recurring_commitment"
          : "actual_paid_revenue",
      );
      if (key === "financial.arr" || key === "financial.contracted_arr")
        emit("P4", "B", 3, "dated_recurring_revenue");
    }
    if (key === "market.size" && n > 0)
      emit("P2", "A", 2, "sized_market_without_independent_demand_validation");
  }
  if (v.kind === "COUNT") {
    const n = number(v.value);
    if (n === null || !Number.isSafeInteger(n) || n < 0) return [];
    if (PAYING_KEYS.has(key) && n > 0) {
      emit("P3", "A", 3, "paying_customers");
      if (n >= 2) emit("P3", "B", 2, "multiple_paying_customers_not_retention");
    }
  }
  if (v.kind === "PERCENT" || v.kind === "PERCENTAGE") {
    const n = number(v.value);
    if (n === null || n < -100 || n > 1000) return [];
    if (key === "financial.nrr" && n >= 0) {
      const grade = n >= 100 ? 3 : 2;
      emit("P3", "B", grade, "measured_net_revenue_retention");
      emit("P4", "B", grade, "retention_supported_traction");
    }
    if (key === "financial.contribution_margin" && n <= 100)
      emit("P5", "A", n > 0 ? 3 : 1, "measured_contribution_margin");
    if (key === "financial.gross_margin" && n <= 100)
      emit("P5", "A", 2, "gross_margin_only_not_contribution_economics");
  }
  // A growth value requires an explicit dated start and end and the metric definition.
  if (
    key === "traction.growth" &&
    (v.kind === "PERCENT" || v.kind === "PERCENTAGE")
  ) {
    const n = number(v.value),
      start = metricDate(v.periodStart),
      end = metricDate(v.periodEnd);
    if (
      n !== null &&
      n >= -100 &&
      n <= 10000 &&
      start !== null &&
      end !== null &&
      start < end &&
      ["REVENUE", "USERS", "USAGE", "PAYING_CUSTOMERS"].includes(
        String(v.metric),
      )
    )
      out.push({
        pillar: "P4",
        criterion: "A",
        grade: n > 0 ? 3 : n === 0 ? 2 : 1,
        at: end,
        rule: "structured.traction.growth.dated_comparable_window",
      });
  }
  return out;
}
/** ISO4217 currencies already present in canonical money inputs; no implicit FX/sector benchmark. */
const CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "ZAR",
  "GHS",
  "EGP",
  "AED",
  "SAR",
  "QAR",
  "MAD",
  "RWF",
  "UGX",
  "TZS",
  "XOF",
  "XAF",
  "INR",
  "CAD",
  "AUD",
  "CHF",
  "JPY",
  "CNY",
  "SGD",
  "BRL",
  "MXN",
]);
/** Confirmed FIGURE labels only; unconfirmed deck extractions never reach this adapter. */
export function deckStructuredFact(fact: {
  readonly label: string;
  readonly value: string | null;
  readonly kind: string;
  readonly asOf: string | null;
}): {
  readonly claimKey: string;
  readonly structuredValue: Readonly<Record<string, unknown>>;
} | null {
  if (fact.kind !== "FIGURE" || fact.value === null) return null;
  const key = DECK_KEYS[fact.label.trim().toLowerCase()];
  if (key === undefined) return null;
  const text = fact.value.trim();
  if (
    key === "financial.nrr" ||
    key === "financial.gross_margin" ||
    key === "financial.contribution_margin"
  ) {
    const m = /^(-?\d+(?:\.\d+)?)\s*%$/u.exec(text);
    return m === null
      ? null
      : {
          claimKey: key,
          structuredValue: { kind: "PERCENT", value: m[1], asOf: fact.asOf },
        };
  }
  if (key === "customers.paying_accounts") {
    const m = /^(\d[\d,]*)$/u.exec(text);
    return m === null
      ? null
      : {
          claimKey: key,
          structuredValue: {
            kind: "COUNT",
            value: Number(m[1]?.replace(/,/gu, "")),
            asOf: fact.asOf,
          },
        };
  }
  const m =
    /^(USD|EUR|GBP|NGN|KES|ZAR|\$)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|billion|bn)?$/iu.exec(
      text,
    );
  if (m === null) return null;
  const amount =
    Number(m[2]?.replace(/,/gu, "")) *
    (["m", "million"].includes((m[3] ?? "").toLowerCase())
      ? 1e6
      : ["bn", "billion"].includes((m[3] ?? "").toLowerCase())
        ? 1e9
        : (m[3] ?? "").toLowerCase() === "k"
          ? 1e3
          : 1);
  return {
    claimKey: key,
    structuredValue: {
      kind: "MONEY",
      amount: String(amount),
      currency: m[1] === "$" ? "USD" : m[1]?.toUpperCase(),
      asOf: fact.asOf,
    },
  };
}
const DECK_KEYS: Readonly<Record<string, string>> = {
  arr: "financial.arr",
  "annual recurring revenue": "financial.arr",
  "contracted arr": "financial.contracted_arr",
  "monthly revenue": "financial.monthly_revenue",
  "paying customers": "customers.paying_accounts",
  "paying accounts": "customers.paying_accounts",
  "net revenue retention": "financial.nrr",
  nrr: "financial.nrr",
  "gross margin": "financial.gross_margin",
  "contribution margin": "financial.contribution_margin",
  "market size": "market.size",
};
