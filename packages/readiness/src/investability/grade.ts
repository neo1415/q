import type { StageBand } from "../investiq/method-v1.js";

/**
 * investability-grading.v1 (lead 2026-10-16): grade a criterion from what
 * the material SAYS, against stage benchmarks, deterministically. No model.
 *
 * Anchors are InvestIQ's 0-4 (2 = what is typical at the company's stage):
 *   4 well above typical   3 above typical   2 typical / on record
 *   1 below typical        0 well below typical (affirmative only)
 * A grade needs a stated fact: a missing figure is unknown, never low. A
 * stage-dependent grade needs the stage; with no stage the fact is only on
 * record (2).
 *
 * Benchmarks and FX rates are versioned calibration hypotheses (public VC
 * benchmarks: Carta, OpenView/High Alpha SaaS benchmarks, YC and a16z
 * guidance on revenue at seed and Series A; see INVESTIQ-METHODOLOGY.md).
 * They are wide on purpose: they place a company in a band, they do not
 * measure it to the dollar.
 */

export const INVESTABILITY_GRADING_VERSION = "investability-grading.v1";

/** Approximate USD per unit, October 2026 (`fx-2026-10.v1`). Order of magnitude only. */
export const FX_USD: Readonly<Record<string, number>> = {
  USD: 1,
  $: 1,
  GBP: 1.27,
  "£": 1.27,
  EUR: 1.08,
  "€": 1.08,
  KES: 0.0077,
  KSH: 0.0077,
  NGN: 0.00065,
  "₦": 0.00065,
  ZAR: 0.055,
  GHS: 0.067,
  EGP: 0.02,
  AED: 0.272,
  SAR: 0.267,
  QAR: 0.275,
  MAD: 0.1,
  RWF: 0.00075,
  UGX: 0.00027,
  TZS: 0.00038,
  XOF: 0.0016,
  INR: 0.012,
};

const CODES = Object.keys(FX_USD)
  .filter((k) => /^[A-Z]{3}$/u.test(k))
  .join("|");
const MONEY_BEFORE = new RegExp(
  `(${CODES}|\\$|£|€|₦)\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|m|mn|bn|b|million|billion|thousand)?\\b`,
  "iu",
);
const MONEY_AFTER = new RegExp(
  `(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|m|mn|bn|b|million|billion|thousand)?\\s*(${CODES})\\b`,
  "iu",
);

function scale(unit: string | undefined): number {
  switch ((unit ?? "").toLowerCase()) {
    case "k":
    case "thousand":
      return 1e3;
    case "m":
    case "mn":
    case "million":
      return 1e6;
    case "b":
    case "bn":
    case "billion":
      return 1e9;
    default:
      return 1;
  }
}

/**
 * The first amount of money in the text: the figure exactly as written
 * ("₦38m") and an order-of-magnitude USD value used ONLY to place it in a
 * stage band. The USD value is never shown: a statement quotes `stated`, so
 * a figure keeps its own currency (stress 2026-10-28 I03: ₦456m became
 * "$296k").
 */
export function moneyOf(
  text: string,
): { readonly stated: string; readonly usd: number } | null {
  const before = MONEY_BEFORE.exec(text);
  const after = before === null ? MONEY_AFTER.exec(text) : null;
  const match = before ?? after;
  const currency = (before?.[1] ?? after?.[3] ?? "").toUpperCase();
  const amount = before?.[2] ?? after?.[1];
  const unit = before?.[3] ?? after?.[2];
  if (match === null || amount === undefined) return null;
  const rate = FX_USD[currency] ?? FX_USD[currency.toLowerCase()];
  if (rate === undefined) return null;
  const n = Number(amount.replace(/,/gu, ""));
  if (!Number.isFinite(n)) return null;
  return { stated: match[0].trim(), usd: n * scale(unit) * rate };
}

/** The first amount of money in the text, in USD; null: none stated. */
export function moneyUsd(text: string): number | null {
  return moneyOf(text)?.usd ?? null;
}

/** The first plain count in the text ("282,063", "46"); null: none. */
export function countOf(text: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b/iu.exec(text);
  if (m?.[1] === undefined) return null;
  const n = Number(m[1].replace(/,/gu, "")) * scale(m[2]);
  return Number.isFinite(n) ? n : null;
}

export function monthsOf(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(?:\d+(?:\.\d+)?)?\s*months?/iu.exec(
    text,
  );
  return m?.[1] === undefined ? null : Number(m[1]);
}

export function percentOf(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*%/u.exec(text);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** [typical low, typical high] for the stage. */
type Benchmark = Readonly<Record<StageBand, readonly [number, number]>>;

/** Monthly recurring revenue, USD (ARR / 12). */
export const MONTHLY_REVENUE_BENCHMARK: Benchmark = {
  PRE_SEED: [1_000, 10_000],
  SEED: [10_000, 80_000],
  SERIES_A: [80_000, 300_000],
  GROWTH: [300_000, 2_000_000],
};
/** Paying business customers. */
export const BUSINESS_CUSTOMERS_BENCHMARK: Benchmark = {
  PRE_SEED: [3, 20],
  SEED: [20, 150],
  SERIES_A: [100, 1_000],
  GROWTH: [500, 5_000],
};
/** Users, homes, members, devices: consumer-scale counts. */
export const USERS_BENCHMARK: Benchmark = {
  PRE_SEED: [100, 2_000],
  SEED: [1_000, 20_000],
  SERIES_A: [10_000, 200_000],
  GROWTH: [100_000, 2_000_000],
};
/** Headcount. */
export const HEADCOUNT_BENCHMARK: Benchmark = {
  PRE_SEED: [2, 6],
  SEED: [5, 20],
  SERIES_A: [15, 60],
  GROWTH: [50, 250],
};

/** Against a stage benchmark: 4 ≥ 3×high, 3 ≥ high, 2 ≥ low, 1 ≥ low/4, else 0. */
export function gradeAgainst(
  value: number,
  stage: StageBand,
  benchmark: Benchmark,
): number {
  const [low, high] = benchmark[stage];
  if (value >= 3 * high) return 4;
  if (value >= high) return 3;
  if (value >= low) return 2;
  // Pre-seed: anything below typical is still on track, never weak.
  if (stage === "PRE_SEED") return 2;
  if (value >= low / 4) return 1;
  return 0;
}

export type Fact = { readonly label: string; readonly value: string };

export type Grade = {
  readonly criterion: string;
  readonly anchor: number;
  /** Plain words for a confirmed fact; never shown for unconfirmed ones. */
  readonly statement: string;
};

const REVENUE = /\b(revenue|mrr|arr|sales|gmv|turnover|income|billings)\b/iu;
const PLAN =
  /\b(forecast|projected|projection|target|plan(?:ned)?|budget|goal|by 20\d\d)\b/iu;
const MONTHLY = /\b(month|monthly|mrr|per month|\/mo|p\.m\.)\b/iu;
/** Annual wins over monthly: "Annualised MRR ₦456m" is a year, not a month. */
const ANNUAL =
  /\b(annual(?:ised|ized)?|annually|arr|yearly|per (?:year|annum)|a year|p\.a\.|fy\s?\d{2,4})\b/iu;
const NONE =
  /\b(pre[- ]?revenue|no revenue|none(?: (?:reported|stated|recorded))?(?: yet)?|not yet (?:paying|reported|generating|earning|monetis\w*)|zero revenue)\b/iu;
const BUSINESS =
  /\b(customers?|clients?|businesses|compan(?:y|ies)|merchants?|schools?|hospitals?|clinics?|sites?|facilities|factories|enterprises?|brands?|retailers?|partners?|buyers?|lenders?|insurers?|banks?)\b/iu;
const USERS =
  /\b(users?|homes?|households?|members?|subscribers?|patients?|farmers?|drivers?|riders?|learners?|students?|devices?|accounts?|downloads?|rooms?)\b/iu;
const ROLE =
  /\b(cto|coo|cfo|cmo|cpo|chief|head of|vp|vice president|director|lead)\b/iu;
const HEADCOUNT =
  /(\d[\d,]*)\s*(people|staff|employees|engineers|fte|team members|headcount)/iu;
const EXPERIENCE =
  /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\+?\s*years|\bex-|\bformer(?:ly)?\b|\bpreviously\b|\bphd\b|\bmba\b|\bled\b|\bbuilt\b|\bscaled\b|\bsenior\b|\bdirector\b|\bpartner at\b|\bat (?:a|an|the) [a-z]/iu;
const PRIOR_DELIVERY =
  /\b(exit(?:ed)?|acquired by|sold (?:to|it|the company)|ipo|serial (?:founder|entrepreneur)|previously (?:co-?)?founded|founded and sold|second-time founder|repeat founder)\b/iu;
const BOTTOM_UP =
  /\b(sam|som|serviceable|obtainable|bottom[- ]up|addressable segment)\b/iu;
const HEADCOUNT_LABEL =
  /\b(headcount|team size|total team|employees|staff|people)\b/iu;
const MARKET_WORDS =
  /\b(market|tam|sam|som|opportunity|industry|addressable)\b/iu;
const MARGIN = /\b(gross margin|margin|contribution)\b/iu;
const UNIT =
  /\b(cac|ltv|payback|unit economics|contribution margin|gross margin)\b/iu;
const RUNWAY = /\brunway\b/iu;
const AFTER_RAISE = /\b(after|from|with) (?:the )?raise\b|\bpost[- ]raise\b/iu;
const PRICE =
  /\b(pric\w*|per (?:seat|user|month|bed|unit|transaction)|subscription|fee|commission|take rate)\b/iu;

const text = (f: Fact) => `${f.label} ${f.value}`;

/**
 * Monthly revenue from the facts (USD for banding only, with the stated
 * figure for the statement), or "NONE" when they say there is none.
 */
function monthlyRevenue(
  facts: readonly Fact[],
): { readonly usd: number; readonly statement: string } | "NONE" | null {
  let best: { usd: number; statement: string } | null = null;
  for (const f of facts) {
    const t = text(f);
    if (!REVENUE.test(t) || PLAN.test(t)) continue;
    const money = moneyOf(f.value) ?? moneyOf(t);
    if (money === null) continue;
    const annual = ANNUAL.test(t) || !MONTHLY.test(t);
    const monthly = annual ? money.usd / 12 : money.usd;
    // Equal amounts (MRR and the same MRR annualised): keep the monthly one.
    if (best === null || monthly > best.usd * 1.001) {
      best = {
        usd: monthly,
        statement: `${money.stated} ${annual ? "a year" : "a month"} in revenue (as stated)`,
      };
    }
  }
  if (best !== null) return best;
  return facts.some((f) => REVENUE.test(text(f)) && NONE.test(f.value))
    ? "NONE"
    : null;
}

/** Grades for a traction-like set of facts (deck TRACTION/FINANCIALS, transcripts). */
export function gradeTraction(
  facts: readonly Fact[],
  stage: StageBand | null,
): Grade[] {
  const out: Grade[] = [];
  const revenue = monthlyRevenue(facts);
  if (revenue === "NONE") {
    out.push({
      criterion: "cp.traction",
      anchor:
        stage === null || stage === "PRE_SEED" ? 2 : stage === "SEED" ? 1 : 0,
      statement: "No revenue yet",
    });
  } else if (revenue !== null) {
    out.push({
      criterion: "cp.traction",
      anchor:
        stage === null
          ? 2
          : gradeAgainst(revenue.usd, stage, MONTHLY_REVENUE_BENCHMARK),
      statement: revenue.statement,
    });
  }
  let business: number | null = null;
  let users: number | null = null;
  for (const f of facts) {
    const t = text(f);
    if (PLAN.test(t) || REVENUE.test(t)) continue;
    const n = countOf(f.value);
    if (n === null || n < 1) continue;
    if (BUSINESS.test(t)) business = Math.max(business ?? 0, n);
    else if (USERS.test(t)) users = Math.max(users ?? 0, n);
  }
  // Counts are graded no lower than 1: what a "customer" or "user" is
  // varies by business, so a small count is below typical, never proof of
  // failure. Revenue, a single unit, can grade 0.
  const floor = (g: number | null) => (g === null ? null : Math.max(1, g));
  const grades = [
    business === null || stage === null
      ? business === null
        ? null
        : 2
      : gradeAgainst(business, stage, BUSINESS_CUSTOMERS_BENCHMARK),
    users === null || stage === null
      ? users === null
        ? null
        : 2
      : gradeAgainst(users, stage, USERS_BENCHMARK),
  ]
    .map(floor)
    .filter((g): g is number => g !== null);
  if (grades.length > 0) {
    out.push({
      criterion: "cp.customer_base",
      anchor: Math.max(...grades),
      statement: [
        business === null ? null : `${String(business)} customers`,
        users === null ? null : `${String(users)} users`,
      ]
        .filter((p) => p !== null)
        .join(", "),
    });
  }
  return out;
}

export function gradeRunway(facts: readonly Fact[]): Grade[] {
  const out: Grade[] = [];
  for (const f of facts) {
    const t = text(f);
    if (!RUNWAY.test(t)) continue;
    const months = monthsOf(f.value) ?? monthsOf(t);
    if (months === null) continue;
    const afterRaise = AFTER_RAISE.test(t);
    // Current runway: under 6 months is a material risk; 18+ is healthy.
    // Runway the raise buys: 18-36 months is the usual plan (fewer is thin).
    const anchor = afterRaise
      ? months < 12
        ? 1
        : months < 18
          ? 2
          : 3
      : months < 6
        ? 0
        : months < 12
          ? 1
          : months < 18
            ? 2
            : 3;
    out.push({
      criterion: afterRaise ? "cs.use_of_funds" : "fh.cash_flow",
      anchor,
      statement: `${String(months)} months of runway${AFTER_RAISE.test(t) ? " after the raise" : ""}`,
    });
  }
  return out;
}

export function gradeUnitEconomics(facts: readonly Fact[]): Grade[] {
  for (const f of facts) {
    const t = text(f);
    if (!UNIT.test(t)) continue;
    const pct = MARGIN.test(t) ? percentOf(f.value) : null;
    if (pct !== null) {
      return [
        {
          criterion: "fh.capital_efficiency",
          anchor: pct >= 70 ? 4 : pct >= 50 ? 3 : pct >= 20 ? 2 : 1,
          statement: `${String(pct)}% margin`,
        },
      ];
    }
    if (/\d/u.test(f.value)) {
      return [
        {
          criterion: "fh.capital_efficiency",
          anchor: 3,
          statement: "Unit economics stated with figures",
        },
      ];
    }
  }
  return [];
}

export function gradePricing(facts: readonly Fact[]): Grade[] {
  const priced = facts.find(
    (f) =>
      PRICE.test(text(f)) &&
      (moneyUsd(f.value) !== null || /\d/u.test(f.value)),
  );
  if (priced !== undefined) {
    return [
      { criterion: "cp.revenue_model", anchor: 3, statement: "Stated pricing" },
    ];
  }
  // A revenue model with no price is on record, not graded.
  return [];
}

export function gradeMarket(facts: readonly Fact[]): Grade[] {
  let largest: number | null = null;
  let stated = "";
  let bottomUp = false;
  for (const f of facts) {
    if (!MARKET_WORDS.test(text(f))) continue;
    const money = moneyOf(f.value) ?? moneyOf(text(f));
    // A market is millions at the least; a smaller figure is a price.
    if (money === null || money.usd < 1e6) continue;
    if (largest === null || money.usd > largest) {
      largest = money.usd;
      stated = money.stated;
    }
    if (BOTTOM_UP.test(text(f))) bottomUp = true;
  }
  if (largest === null) return [];
  let anchor =
    largest >= 20e9 ? 4 : largest >= 1e9 ? 3 : largest >= 100e6 ? 2 : 1;
  // A sized, reachable segment makes the number more credible: one step
  // up, never from "too small" straight to "large".
  if (bottomUp && anchor >= 2) anchor = Math.min(4, anchor + 1);
  return [
    {
      criterion: "mo.market_size",
      anchor,
      statement: `Market sized at ${stated} (as stated)${bottomUp ? ", with a reachable segment" : ""}`,
    },
  ];
}

export function gradeTeam(
  facts: readonly Fact[],
  stage: StageBand | null,
): Grade[] {
  const roles = new Set<string>();
  let headcount: number | null = null;
  for (const f of facts) {
    const t = text(f);
    const role = ROLE.exec(t);
    if (role !== null && f.value.trim().length > 0)
      roles.add(`${f.label}`.toLowerCase());
    const hc = HEADCOUNT.exec(t);
    const labelled = HEADCOUNT_LABEL.test(f.label) ? countOf(f.value) : null;
    const n =
      hc?.[1] !== undefined ? Number(hc[1].replace(/,/gu, "")) : labelled;
    if (n !== null && Number.isFinite(n) && n > 0) {
      headcount = Math.max(headcount ?? 0, n);
    }
  }
  // A few names and titles are on record, not graded.
  if (headcount === null && roles.size < 3) return [];
  let anchor = 2;
  if (stage !== null) {
    const byHeadcount =
      headcount === null
        ? 2
        : Math.min(3, gradeAgainst(headcount, stage, HEADCOUNT_BENCHMARK));
    const byRoles = roles.size >= 5 ? 4 : roles.size >= 3 ? 3 : 2;
    anchor = Math.max(
      byHeadcount,
      stage === "PRE_SEED" || stage === "SEED" ? byRoles : Math.min(byRoles, 3),
    );
  }
  return [
    {
      criterion: "fl.leadership_depth",
      anchor,
      statement: [
        roles.size === 0
          ? null
          : `${String(roles.size)} named leadership roles`,
        headcount === null ? null : `team of ${String(headcount)}`,
      ]
        .filter((p) => p !== null)
        .join(", "),
    },
  ];
}

export function gradeFounders(facts: readonly Fact[]): Grade[] {
  if (facts.length === 0) return [];
  const all = facts.map(text).join(" ");
  const prior = facts.some((f) => PRIOR_DELIVERY.test(text(f)));
  const experience = facts.filter((f) => EXPERIENCE.test(text(f))).length;
  const technical = /\bcto\b|technical|engineer/iu.test(all);
  const commercial = /\bceo\b|commercial|sales|business/iu.test(all);
  // Names and roles alone are on record, not graded: nothing is said
  // about the founders' quality, so nothing is scored from it.
  if (!prior && experience < 1 && !(technical && commercial)) return [];
  return [
    {
      criterion: "fl.founder_quality",
      anchor: prior ? 4 : 3,
      statement: prior
        ? "A founder has founded or exited a company before"
        : experience >= 1
          ? "Founders' relevant experience stated"
          : "Technical and commercial founders",
    },
  ];
}
