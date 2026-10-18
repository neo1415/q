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
  const namedMonth =
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d\d)$/iu.exec(
      value.trim(),
    );
  if (namedMonth !== null) {
    const month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf((namedMonth[1] ?? "").slice(0, 3).toLowerCase()) + 1;
    return `${namedMonth[2]}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
  }
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
  const captured =
    key === "market.size" &&
    typeof v.evidenceCapturedAt === "string" &&
    Number.isFinite(Date.parse(v.evidenceCapturedAt))
      ? new Date(v.evidenceCapturedAt).toISOString()
      : null;
  const at =
    metricDate(v.asOf) ??
    metricDate(v.periodEnd) ??
    metricDate(v.period) ??
    captured;
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
      rule:
        captured !== null
          ? `structured.${key}.${rule}; evidence captured ${captured}; market measurement period unknown`
          : `structured.${key}.${rule}; measured ${String(v.amount ?? v.value)}${typeof v.currency === "string" ? ` ${v.currency}` : ""}; period ${at ?? "unknown"}`,
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
  if (key === "financial.runway_months" && v.kind === "MONTHS") {
    const months = number(v.value);
    if (months !== null && months >= 0 && months <= 1200)
      emit(
        "P8",
        "A",
        months >= 12 ? 3 : months > 0 ? 2 : 0,
        "measured_current_cash_runway",
      );
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
      ["ARR", "REVENUE", "USERS", "USAGE", "PAYING_CUSTOMERS"].includes(
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
  "VND",
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
  const label = fact.label.trim().toLowerCase();
  const text = fact.value.trim();
  const key =
    DECK_KEYS[label] ??
    (/\b(?:arr|annual recurring revenue)\b/iu.test(label)
      ? "financial.arr"
      : /\b(?:mrr|monthly recurring revenue)\b/iu.test(label)
        ? "financial.monthly_revenue"
        : /\b(?:tam|sam|som|market size)\b/iu.test(label)
          ? "market.size"
          : /\bnet revenue retention\b|\bNRR\b/iu.test(`${label} ${text}`)
            ? "financial.nrr"
            : undefined);
  if (key === undefined) return null;
  if (
    /\b(forecast|projected|projection|target|planned)\b/iu.test(
      `${label} ${text}`,
    )
  )
    return null;
  if (key === "financial.arr" && /\b(trend|growth)\b/iu.test(label)) {
    const window =
      /^(?:from\s+)?(.+?)\s+in\s+(.+?)\s+to\s+(.+?)\s+in\s+(.+)$/iu.exec(text);
    if (window === null) return null;
    const start = monetaryFigure(window[1] ?? ""),
      end = monetaryFigure(window[3] ?? "");
    const periodStart = metricDate(window[2]),
      periodEnd = metricDate(window[4]);
    if (
      start === null ||
      end === null ||
      start.currency !== end.currency ||
      Number(start.amount) <= 0 ||
      periodStart === null ||
      periodEnd === null ||
      periodStart >= periodEnd
    )
      return null;
    return {
      claimKey: "traction.growth",
      structuredValue: {
        kind: "PERCENT",
        metric: "ARR",
        value:
          ((Number(end.amount) - Number(start.amount)) / Number(start.amount)) *
          100,
        periodStart: periodStart.slice(0, 10),
        periodEnd: periodEnd.slice(0, 10),
        startAmount: start.amount,
        endAmount: end.amount,
        currency: start.currency,
        asOf: fact.asOf,
      },
    };
  }
  if (key === "financial.runway_months") {
    const months =
      /^(?:about\s+|approximately\s+|~\s*)?(\d+(?:\.\d+)?)\s+months?$/iu.exec(
        text,
      );
    return months === null
      ? null
      : {
          claimKey: key,
          structuredValue: {
            kind: "MONTHS",
            value: months[1],
            asOf: fact.asOf,
          },
        };
  }
  if (
    key === "financial.nrr" ||
    key === "financial.gross_margin" ||
    key === "financial.contribution_margin"
  ) {
    const m =
      /^(-?\d+(?:\.\d+)?)\s*%(?:\s+(net revenue retention|NRR|gross margin|contribution margin))?$/iu.exec(
        text,
      );
    const annotation = m?.[2]?.toLowerCase();
    const expected =
      key === "financial.nrr"
        ? ["net revenue retention", "nrr"]
        : [
            key === "financial.gross_margin"
              ? "gross margin"
              : "contribution margin",
          ];
    if (annotation !== undefined && !expected.includes(annotation)) return null;
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
  const money = monetaryFigure(text);
  return money === null
    ? null
    : {
        claimKey: key,
        structuredValue: { kind: "MONEY", ...money, asOf: fact.asOf },
      };
}
function monetaryFigure(
  text: string,
): { readonly amount: string; readonly currency: string } | null {
  const m =
    /^(?:about\s+|approximately\s+|~\s*)?(USD|EUR|GBP|NGN|KES|ZAR|AUD|CAD|INR|VND|SGD|CHF|JPY|CNY|\$|£|€|₦|₹|₫)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|billion|bn)?(?:\s+(?:annual revenue|ARR|MRR|run.rate))?$/iu.exec(
      text,
    );
  if (m === null || m[1] === undefined) return null;
  const amount =
    Number(m[2]?.replace(/,/gu, "")) *
    (["m", "million"].includes((m[3] ?? "").toLowerCase())
      ? 1e6
      : ["bn", "billion"].includes((m[3] ?? "").toLowerCase())
        ? 1e9
        : (m[3] ?? "").toLowerCase() === "k"
          ? 1e3
          : 1);
  if (!Number.isFinite(amount)) return null;
  return {
    amount: String(amount),
    currency:
      {
        $: "USD",
        "£": "GBP",
        "€": "EUR",
        "₦": "NGN",
        "₹": "INR",
        "₫": "VND",
      }[m[1] ?? ""] ?? m[1]?.toUpperCase(),
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
  runway: "financial.runway_months",
  "current runway": "financial.runway_months",
  "cash runway": "financial.runway_months",
  "runway at current burn": "financial.runway_months",
};
/** Current, confirmed narrative claims have a capture date, not an invented measurement period. */
export function confirmedNarrativeSignals(
  section: string,
  label: string,
  value: string,
  recordedAt: string,
): readonly StructuredSignal[] {
  const text = `${label} ${value}`;
  if (
    /\b(forecast|projection|projected|target|hypothetical|could|would|not yet|no evidence)\b/iu.test(
      text,
    )
  )
    return [];
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
      at: recordedAt,
      rule: `confirmed-narrative.${section}.${rule}; evidence captured ${recordedAt}, not a metric measurement date`,
    });
  if (section === "FOUNDERS") {
    if (
      /\b(?:\d+\+?\s*years?|previously|former|experience|background|expertise)\b/iu.test(
        text,
      )
    )
      emit(
        "P1",
        "A",
        2,
        "specific_professional_experience_not_independently_validated_domain_fit",
      );
    if (
      /\b(?:previously (?:built|founded|led|scaled)|founded and (?:sold|scaled)|shipped|delivered|successful exit)\b/iu.test(
        text,
      )
    )
      emit("P1", "B", 3, "affirmative_prior_delivery");
  }
  if (section === "MARKET") {
    if (
      /\b(?:expand|expansion|enter|launch).{0,70}\b(?:market|countr|region|geograph|adjacent)/iu.test(
        text,
      )
    )
      emit("P2", "B", 2, "specific_expansion_plan_not_execution");
    if (
      /\b(?:new regulation|regulatory change|regulatory reform|structural shift|growing demand|rising demand|adoption (?:is )?(?:growing|rising))\b/iu.test(
        text,
      )
    )
      emit(
        "P10",
        "A",
        2,
        "claimed_structural_tailwind_not_independent_verification",
      );
  }
  if (section === "PROBLEM") {
    if (
      /\b(?:customers?|buyers?|businesses|merchants?|patients?|farmers?|companies|smes?|enterprises?)\b/iu.test(
        text,
      ) &&
      /\b(?:manual|expensive|unreliable|fragmented|slow|costly|loss|lost|delay)\b/iu.test(
        text,
      )
    )
      emit("P3", "A", 2, "specific_customer_problem_claim_not_paid_validation");
  }
  if (section === "TRACTION" || section === "SOLUTION") {
    if (
      /\b(?:pilot|customer test).{0,60}\b(?:completed|successful|live|operational)\b/iu.test(
        text,
      ) &&
      !/\b(?:retention|renewal|cohort|growth|percent|%)\b/iu.test(text)
    )
      emit("P3", "B", 2, "completed_stage_appropriate_pilot_claim");
  }
  if (section === "COMPETITION") {
    if (
      /\b(?:proprietary|patented|licensed|exclusive (?:data|license|technology)|network effect)\b/iu.test(
        text,
      )
    )
      emit("P6", "A", 2, "specific_claimed_differentiated_asset");
    if (
      /\b(?:unlike|compared (?:with|to)|whereas|alternatives?).{0,120}\b(?:integration|cost|price|speed|workflow|data|distribution|feature|support)\b/iu.test(
        text,
      )
    )
      emit("P6", "B", 2, "specific_comparative_claim_not_independent_test");
  }
  if (section === "GO_TO_MARKET") {
    if (
      /\b(?:direct sales|channel partners|partner distribution|enterprise sales|distribution agreement|sales agents|reseller|referral channel)\b/iu.test(
        text,
      )
    )
      emit(
        "P7",
        "A",
        2,
        "specified_acquisition_mechanism_not_proven_repeatability",
      );
    if (
      /\b(?:word.of.mouth|referrals|organic acquisition|organic demand)\b/iu.test(
        text,
      )
    )
      emit(
        "P7",
        "B",
        2,
        "specific_organic_channel_claim_not_measured_efficiency",
      );
  }
  if (section === "SOLUTION" || section === "GO_TO_MARKET") {
    if (
      /\b(?:deployed|operational|serving).{0,70}\b(?:multiple countries|multiple markets|across countries|across markets|multiple customers)\b/iu.test(
        text,
      )
    )
      emit("P11", "B", 2, "claimed_repeat_deployment");
    if (
      /\b(?:active partnership|executed partnership|signed (?:distribution|partnership)|partnership agreement)\b/iu.test(
        text,
      )
    )
      emit(
        "P12",
        "A",
        2,
        "specific_partner_agreement_claim_not_quality_inference",
      );
  }
  return out;
}
