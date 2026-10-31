import type {
  EvidenceStatus,
  FitContextItem,
  FitHardRuleDto,
  FitParameter,
  FitParameterContext,
} from "@capital-q/contracts";

import type { RecommendationFeatureSnapshot } from "../features/contracts.js";
import type { EligibilityReasonCode } from "../eligibility/contracts.js";

import type { FitConfig } from "./config.js";
import {
  notApplicableObservation,
  unknownObservation,
  type FitInputs,
  type FitObservation,
} from "./model.js";
import { estimateInCurrency, type FxReferenceRates } from "../fx/ecb.js";

/**
 * From inputs to observations (B1): deterministic comparators, one per
 * parameter. Four read the persisted feature snapshot the Discover ranker
 * already computed (stage, geography, sector, thesis similarity), so the
 * fit and the feed never disagree about those; five compare declared
 * facts (cheque, business model, traction, team, round terms).
 *
 * Every input is optional. An absent input is UNKNOWN, never a mismatch;
 * an absent preference on the investor's side is NOT APPLICABLE.
 *
 * No parameter reads, or could read, a founder's age, gender, ethnicity,
 * nationality or photo: the types below have no field for any of them.
 */

export type DeclaredMoney = {
  /** Decimal string, as money is stored; compared, never stored as float. */
  readonly amount: string;
  readonly currency: string;
};

export type DeclaredFitFacts = {
  /** Display facts for reason sentences (already visible to the reader). */
  readonly companyStage?: string | undefined;
  readonly mandateStages?: string | undefined;
  readonly companySector?: string | undefined;
  readonly companyPlace?: string | undefined;

  /**
   * Parameters the investor declared as "Must match" (live 2026-10-29:
   * Mizan, Cairo, read "8.3/10 · Good fit" against a mandate whose
   * geography must match Nigeria, Ghana or Kenya). Their own declared
   * requirement, never inferred; see `mustMatchRuleFrom`.
   */
  readonly mustMatch?:
    | {
        readonly stage?: boolean | undefined;
        readonly geography?: boolean | undefined;
      }
    | undefined;

  /**
   * How firmly the investor declared their geography ("Must", "Strong",
   * "Nice"), from their own positive geography selection; absent when
   * they declared none. Read by fit-order.v3 only; never scored here.
   */
  readonly geographyStrength?: "MUST" | "STRONG" | "NICE" | undefined;

  /**
   * What the company has STATED about its round where this reader may see
   * it -- said in a pitch they may play, or in a deck section the founder
   * confirmed -- but not formally shared as its raise. Context for the
   * reason sentence only: it never moves an outcome, the band or the
   * confidence (scoring stays on `round`, the formally shared raise).
   * Display strings with their source, e.g. "$4M (pitch and deck)".
   */
  readonly statedRound?:
    | {
        readonly raise?: string | undefined;
        readonly minimumCheque?: string | undefined;
        /** Instrument and terms, e.g. "Post-money SAFE, $30m cap". */
        readonly terms?: string | undefined;
        /** The same, as values with their sources, for the row itself. */
        readonly raiseItems?: readonly FitContextItem[] | undefined;
        readonly termsItems?: readonly FitContextItem[] | undefined;
      }
    | null
    | undefined;

  /** The round as shared with this reader. */
  readonly round?:
    | (DeclaredMoney & {
        readonly evidenceStatus: EvidenceStatus | null;
        /**
         * SHARED: the capital objective, disclosed or on the Q Card. PITCH:
         * the raise the company stated in a pitch this reader may play
         * (owner 23 Oct 2026: investor-visible material counts). Absent:
         * SHARED, as before.
         */
        readonly source?: "SHARED" | "PITCH" | undefined;
      })
    | null
    | undefined;
  /**
   * Current exchange rate sets, preferred first (the ECB's reference
   * rates, then the public market feed), for an ESTIMATE when the round
   * and the cheque are in different currencies. Fetched from the internet
   * when none is stored (fx/live.ts). Absent: never converted.
   */
  readonly fx?:
    FxReferenceRates | readonly FxReferenceRates[] | null | undefined;
  /** The investor's own declared cheque range. */
  readonly cheque?:
    | {
        readonly currency: string;
        readonly min?: string | undefined;
        readonly typical?: string | undefined;
        readonly max?: string | undefined;
      }
    | null
    | undefined;

  readonly businessModel?:
    | {
        readonly code: string;
        readonly label: string;
        readonly evidenceStatus: EvidenceStatus | null;
      }
    | null
    | undefined;
  readonly businessModelPreferences?:
    | {
        readonly preferred: readonly string[];
        readonly avoided: readonly string[];
      }
    | null
    | undefined;

  readonly monthlyRevenue?:
    | (DeclaredMoney & {
        readonly observedAt: string;
        readonly evidenceStatus: EvidenceStatus | null;
      })
    | null
    | undefined;
  readonly tractionMinimum?: DeclaredMoney | null | undefined;

  readonly team?:
    | {
        readonly fullTimeFounders: boolean | null;
        readonly technicalCofounder: boolean | null;
        /** A short declared description, e.g. "Technical co-founder, 8 years in the field". */
        readonly summary?: string | undefined;
        readonly evidenceStatus: EvidenceStatus | null;
      }
    | null
    | undefined;
  readonly teamRequirements?:
    | {
        readonly fullTime?: "MUST" | "PREFER" | undefined;
        readonly technical?: "MUST" | "PREFER" | undefined;
      }
    | null
    | undefined;

  readonly roundTerms?:
    | {
        readonly needsLead: boolean | null;
        /** e.g. "SAFE, lead committed". */
        readonly summary?: string | undefined;
        readonly evidenceStatus: EvidenceStatus | null;
      }
    | null
    | undefined;
  readonly leadPolicy?: "ALWAYS" | "SOMETIMES" | "NEVER" | null | undefined;
};

/** What the fit reads of a feature snapshot: its values. */
export type FitFeatureSource = Pick<RecommendationFeatureSnapshot, "features">;

export type ObserveFitInput = {
  readonly companyId: string;
  /**
   * The CURRENT persisted snapshot for this pair, if the ranker made one;
   * else the same values computed on read (live e11). Only `features` is read.
   */
  readonly snapshot: FitFeatureSource | null;
  readonly declared: DeclaredFitFacts;
  /** Eligibility's reason codes for this pair (purpose VIEW); hard rules come only from these. */
  readonly eligibilityReasons: readonly EligibilityReasonCode[];
  readonly config: FitConfig;
  /** For traction freshness. Passed in so the model never reads a clock. */
  readonly now: Date;
};

/** Eligibility reason codes that ARE a declared mandate rule failing. */
const HARD_RULES: Partial<Record<EligibilityReasonCode, FitHardRuleDto>> = {
  EXPLICIT_HARD_EXCLUSION: {
    code: "DECLARED_EXCLUSION",
    label: "Outside a rule you set: one of your declared exclusions applies.",
  },
  STAGE_OUTSIDE_HARD_MANDATE: {
    code: "STAGE_OUTSIDE_STRICT_RANGE",
    label: "Outside a rule you set: their stage is outside your strict range.",
  },
  GEOGRAPHY_OUTSIDE_HARD_MANDATE: {
    code: "EXCLUDED_GEOGRAPHY",
    label: "Outside a rule you set: their location is one you exclude.",
  },
};

export function hardRuleFrom(
  reasons: readonly EligibilityReasonCode[],
): FitHardRuleDto | null {
  for (const code of reasons) {
    const rule = HARD_RULES[code];
    if (rule !== undefined) return rule;
  }
  return null;
}

const MUST_MATCH_RULES = {
  STAGE: {
    code: "STAGE_OUTSIDE_STRICT_RANGE",
    label:
      "Outside a rule you set: their stage is not one you said must match.",
  },
  GEOGRAPHY: {
    code: "EXCLUDED_GEOGRAPHY",
    label:
      "Outside a rule you set: their location is not one you said must match.",
  },
} as const satisfies Partial<Record<FitParameter, FitHardRuleDto>>;

/**
 * A parameter the investor declared "Must match" that the company's own
 * declared facts positively miss is their declared rule failing, so the
 * fit is OUTSIDE_MANDATE (no score), never a weighted miss inside a "Good
 * fit". Only a MISMATCH counts: an UNKNOWN never excludes (ADR 0020), and
 * a region-level PARTIAL still meets a country list's region. Eligibility
 * (Discover) is unchanged: there MUST stays a ranking preference
 * (eligibility.v3); this is the fit's own reading of a declared rule.
 */
export function mustMatchRuleFrom(
  observations: Readonly<Record<FitParameter, FitObservation>>,
  must: DeclaredFitFacts["mustMatch"],
): FitHardRuleDto | null {
  if (must === undefined) return null;
  if (must.stage === true && observations.STAGE.outcome === "MISMATCH") {
    return MUST_MATCH_RULES.STAGE;
  }
  if (
    must.geography === true &&
    observations.GEOGRAPHY.outcome === "MISMATCH"
  ) {
    return MUST_MATCH_RULES.GEOGRAPHY;
  }
  return null;
}

const SECTOR_OUTCOME = {
  EXACT: "STRONG",
  DESCENDANT: "PARTIAL",
  NONE: "MISMATCH",
} as const;

export function observeFit(input: ObserveFitInput): FitInputs {
  const { snapshot, declared: d, config } = input;
  const feature = (id: string) =>
    snapshot?.features.find((f) => f.featureId === id) ?? null;

  const fromCategory = (
    id: string,
    map: Readonly<Record<string, "STRONG" | "PARTIAL" | "MISMATCH">>,
    facts: Readonly<Record<string, string | undefined>>,
  ): FitObservation => {
    const f = feature(id);
    if (f === null) return unknownObservation(facts);
    if (f.status !== "PRESENT") {
      return f.missingReason === "NO_DECLARED_PREFERENCE" ||
        f.missingReason === "UNRESTRICTED_PREFERENCE"
        ? notApplicableObservation()
        : unknownObservation(facts);
    }
    const outcome = typeof f.value === "string" ? map[f.value] : undefined;
    if (outcome === undefined) return unknownObservation(facts);
    return {
      outcome,
      applicable: true,
      // Canonical company fields are declared by the company itself.
      evidenceStatus: "SELF_REPORTED",
      stale: false,
      facts,
    };
  };

  // QO-11 (QA 2026-10-23): Sector is the company's sector. A taxonomy
  // match only in a business model or customer type the mandate names
  // (each its own parameter) is never a strong sector; the feature's
  // `sectorOverlap` says how the sector itself stands. Older snapshots
  // without it read the category as before.
  const sectorObservation = (): FitObservation => {
    const f = feature("declared_fit.taxonomy");
    // A snapshot from before `sectorOverlap` (or a bare one) has none.
    const provenance: Readonly<Record<string, unknown>> | undefined =
      f?.status === "PRESENT" ? f.provenance : undefined;
    const sector = provenance?.["sectorOverlap"];
    const facts = { companySector: d.companySector };
    if (sector === "UNKNOWN") return unknownObservation(facts);
    if (sector === "EXACT" || sector === "DESCENDANT" || sector === "NONE") {
      return fromCategory(
        "declared_fit.taxonomy",
        {
          EXACT_OVERLAP: SECTOR_OUTCOME[sector],
          DESCENDANT_OVERLAP: SECTOR_OUTCOME[sector],
        },
        facts,
      );
    }
    return fromCategory(
      "declared_fit.taxonomy",
      {
        EXACT_OVERLAP: "STRONG",
        DESCENDANT_OVERLAP: "PARTIAL",
        NO_OVERLAP: "MISMATCH",
      },
      facts,
    );
  };

  const observations: Record<FitParameter, FitObservation> = {
    STAGE: fromCategory(
      "declared_fit.stage",
      { MATCH: "STRONG", NO_MATCH: "MISMATCH" },
      { companyStage: d.companyStage, mandateStages: d.mandateStages },
    ),
    SECTOR: sectorObservation(),
    GEOGRAPHY: fromCategory(
      "declared_fit.geography",
      {
        COUNTRY_MATCH: "STRONG",
        REGION_MATCH: "PARTIAL",
        NO_MATCH: "MISMATCH",
      },
      { companyPlace: d.companyPlace },
    ),
    CHEQUE_SIZE: observeCheque(d, config),
    BUSINESS_MODEL: observeBusinessModel(d),
    TRACTION: observeTraction(d, config, input.now),
    TEAM: observeTeam(d),
    THESIS: observeThesis(feature("semantic_fit.mandate_similarity"), config),
    ROUND_TERMS: observeRoundTerms(d),
  };

  return {
    companyId: input.companyId,
    observations,
    hardRule:
      hardRuleFrom(input.eligibilityReasons) ??
      mustMatchRuleFrom(observations, d.mustMatch),
  };
}

function observeThesis(
  f: { status: string; value: unknown; missingReason: string | null } | null,
  config: FitConfig,
): FitObservation {
  if (f === null || f.status !== "PRESENT" || typeof f.value !== "number") {
    return unknownObservation();
  }
  const { thesisStrongMin, thesisPartialMin } = config.comparators;
  return {
    outcome:
      f.value >= thesisStrongMin
        ? "STRONG"
        : f.value >= thesisPartialMin
          ? "PARTIAL"
          : "MISMATCH",
    applicable: true,
    // A similarity is computed, not declared; it carries no evidence status.
    evidenceStatus: null,
    stale: false,
    facts: {},
  };
}

function amountOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * "$4M (pitch and deck), minimum cheque $100k": what they stated, only when
 * the round was not formally shared (a shared raise is the raise).
 */
function statedRaise(d: DeclaredFitFacts): string | undefined {
  const stated = d.statedRound ?? null;
  if ((d.round ?? null) !== null || stated?.raise === undefined)
    return undefined;
  return stated.minimumCheque === undefined
    ? stated.raise
    : `${stated.raise}, minimum cheque ${stated.minimumCheque}`;
}

function observeCheque(d: DeclaredFitFacts, config: FitConfig): FitObservation {
  const cheque = d.cheque ?? null;
  const ref =
    cheque === null
      ? null
      : (amountOf(cheque.typical) ??
        amountOf(cheque.max) ??
        amountOf(cheque.min));
  const said = statedRaise(d);
  if (cheque === null || ref === null) {
    return {
      ...notApplicableObservation({ statedRaise: said }),
      stated: said !== undefined,
      context: chequeContext(
        d,
        null,
        "Ticket fit: you have not set a cheque size",
      ),
    };
  }
  const round = d.round ?? null;
  const roundAmount = amountOf(round?.amount);
  const fromPitch = round?.source === "PITCH";
  const otherCurrency = round !== null && round.currency !== cheque.currency;
  // Owner 23 Oct 2026: across currencies, an estimate at a dated public
  // rate (the ECB's first, then the market feed for a currency the ECB
  // does not publish); never called exact.
  const sets: readonly FxReferenceRates[] =
    d.fx === null || d.fx === undefined
      ? []
      : "perEuro" in d.fx
        ? [d.fx]
        : d.fx;
  let fx: FxReferenceRates | null = null;
  let converted: string | null = null;
  if (round !== null && otherCurrency) {
    for (const set of sets) {
      const estimate = estimateInCurrency(
        round.amount,
        round.currency,
        cheque.currency,
        set,
      );
      if (estimate !== null) {
        fx = set;
        converted = estimate;
        break;
      }
    }
  }
  const facts = {
    chequeSize:
      cheque.typical === undefined
        ? undefined
        : formatMoney(cheque.typical, cheque.currency),
    chequeRange:
      cheque.min !== undefined && cheque.max !== undefined
        ? `${formatMoney(cheque.min, cheque.currency)}–${formatMoney(cheque.max, cheque.currency)}`
        : undefined,
    chequeCurrency: cheque.currency,
    // The whole declared cheque: the range when they gave one, else the
    // typical cheque ("$250k–$1M", "€3M").
    yourCheque:
      cheque.min !== undefined && cheque.max !== undefined
        ? `${formatMoney(cheque.min, cheque.currency)}–${formatMoney(cheque.max, cheque.currency)}`
        : cheque.typical !== undefined
          ? formatMoney(cheque.typical, cheque.currency)
          : undefined,
    roundSize:
      round === null
        ? undefined
        : `${formatMoney(round.amount, round.currency)}${fromPitch ? " (from their pitch)" : ""}`,
    statedRaise: said,
    roundOtherCurrency:
      round !== null && otherCurrency && converted === null
        ? formatMoney(round.amount, round.currency)
        : undefined,
    roundEstimate:
      converted === null ? undefined : formatMoney(converted, cheque.currency),
    rateDate:
      converted === null || fx === null ? undefined : humanDate(fx.rateDate),
    rateSource:
      converted === null || fx === null ? undefined : RATE_WORDS[fx.source],
  };
  if (round === null || roundAmount === null || roundAmount === 0) {
    return {
      ...unknownObservation(facts),
      stated: said !== undefined,
      unknownReason: "ROUND_NOT_SHARED",
      context: chequeContext(
        d,
        facts.chequeSize ?? facts.chequeRange,
        said !== undefined
          ? "Ticket fit: not scored until the round is shared"
          : "Round amount: not shared with you",
      ),
    };
  }
  if (otherCurrency && converted === null) {
    return {
      ...unknownObservation(facts),
      unknownReason: "CURRENCY_DIFFERS_NO_RATE",
      context: chequeContext(
        d,
        facts.chequeSize ?? facts.chequeRange,
        `Ticket fit: not compared, the round is in ${round.currency} and your cheque in ${cheque.currency}`,
      ),
    };
  }
  const compared = converted === null ? roundAmount : amountOf(converted);
  if (compared === null || compared === 0) {
    return { ...unknownObservation(facts), unknownReason: "ROUND_NOT_SHARED" };
  }
  const share = ref / compared;
  // "up to 40% of it": the largest declared cheque against the round, in
  // whole percent; said only when it is a real share of the round.
  const top =
    amountOf(cheque.max) ?? amountOf(cheque.typical) ?? amountOf(cheque.min);
  const topShare = top === null ? null : top / compared;
  const sharedFacts = {
    ...facts,
    chequeShare:
      topShare === null || topShare <= 0 || topShare > 1
        ? undefined
        : `${String(Math.max(1, Math.round(topShare * 100)))}%`,
  };
  const c = config.comparators;
  const outcome =
    share >= c.chequeShareStrongMin && share <= c.chequeShareStrongMax
      ? "STRONG"
      : share >= c.chequeSharePartialMin
        ? "PARTIAL"
        : "MISMATCH";
  return {
    outcome,
    applicable: true,
    evidenceStatus: round.evidenceStatus,
    stale: false,
    facts: sharedFacts,
    ...(converted === null || fx === null
      ? {}
      : {
          estimate: {
            method: RATE_METHOD[fx.source],
            rateDate: fx.rateDate,
            truthClass: "ESTIMATE" as const,
          },
        }),
    context: chequeContext(
      d,
      facts.chequeSize ?? facts.chequeRange,
      converted === null || fx === null
        ? null
        : `Approximately, at ${RATE_WORDS[fx.source]} of ${humanDate(fx.rateDate)}`,
    ),
  };
}

/** How a rate's source is said: "about €3.5M at the ECB rate of 23 Oct 2026". */
const RATE_WORDS: Readonly<Record<FxReferenceRates["source"], string>> = {
  ECB_EUROFXREF: "the ECB rate",
  EXCHANGERATE_API_OPEN: "the market rate",
};
const RATE_METHOD = {
  ECB_EUROFXREF: "ECB_REFERENCE_RATE",
  EXCHANGERATE_API_OPEN: "MARKET_RATE",
} as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-10-23" -> "23 Oct 2026"; the ISO date itself when malformed. */
function humanDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  const month = match === null ? undefined : MONTHS[Number(match[2]) - 1];
  return match === null || month === undefined
    ? iso
    : `${String(Number(match[3]))} ${month} ${match[1] ?? ""}`;
}

/**
 * What is known beside the cheque row, each value with its source: the
 * round (shared, or as stated in the pitch or deck), the investor's own
 * cheque, the minimum cheque the deck states. `open` says separately what
 * is not concluded, so an unknown ticket fit never reads as an unknown
 * round amount. Display only; nothing here is scored.
 */
function chequeContext(
  d: DeclaredFitFacts,
  yourCheque: string | undefined | null,
  open: string | null,
): FitParameterContext | undefined {
  const round = d.round ?? null;
  const items: FitContextItem[] = [
    ...(round === null
      ? [...(d.statedRound?.raiseItems ?? [])]
      : [
          {
            label: "Round",
            value: formatMoney(round.amount, round.currency),
            source:
              round.source === "PITCH"
                ? ("PITCH" as const)
                : ("SHARED" as const),
          },
        ]),
    ...(yourCheque === undefined || yourCheque === null
      ? []
      : [
          {
            label: "Your cheque",
            value: yourCheque,
            source: "YOUR_MANDATE" as const,
          },
        ]),
    ...(round === null && d.statedRound?.minimumCheque !== undefined
      ? [
          {
            label: "Minimum cheque",
            value: d.statedRound.minimumCheque,
            source: "DECK" as const,
          },
        ]
      : []),
  ];
  return items.length === 0 && open === null ? undefined : { items, open };
}

function observeBusinessModel(d: DeclaredFitFacts): FitObservation {
  const prefs = d.businessModelPreferences ?? null;
  if (
    prefs === null ||
    (prefs.preferred.length === 0 && prefs.avoided.length === 0)
  ) {
    return notApplicableObservation();
  }
  const model = d.businessModel ?? null;
  if (model === null) return unknownObservation();
  const outcome = prefs.avoided.includes(model.code)
    ? "MISMATCH"
    : prefs.preferred.includes(model.code)
      ? "STRONG"
      : "PARTIAL";
  return {
    outcome,
    applicable: true,
    evidenceStatus: model.evidenceStatus,
    stale: false,
    facts: { businessModel: model.label },
  };
}

function observeTraction(
  d: DeclaredFitFacts,
  config: FitConfig,
  now: Date,
): FitObservation {
  const minimum = d.tractionMinimum ?? null;
  const minAmount = amountOf(minimum?.amount);
  if (minimum === null || minAmount === null) return notApplicableObservation();
  const revenue = d.monthlyRevenue ?? null;
  const facts = {
    tractionMinimum: formatMoney(minimum.amount, minimum.currency),
    revenue:
      revenue === null
        ? undefined
        : formatMoney(revenue.amount, revenue.currency),
  };
  const amount = amountOf(revenue?.amount);
  if (
    revenue === null ||
    amount === null ||
    revenue.currency !== minimum.currency
  ) {
    return unknownObservation(facts);
  }
  const ageDays =
    (now.getTime() - new Date(revenue.observedAt).getTime()) / 86_400_000;
  const outcome =
    amount >= minAmount
      ? "STRONG"
      : amount >= minAmount * config.comparators.tractionPartialShare
        ? "PARTIAL"
        : "MISMATCH";
  return {
    outcome,
    applicable: true,
    evidenceStatus: revenue.evidenceStatus,
    stale: ageDays > config.comparators.tractionFreshDays,
    facts,
  };
}

function observeTeam(d: DeclaredFitFacts): FitObservation {
  const req = d.teamRequirements ?? null;
  const asks = [
    ["fullTime", req?.fullTime, d.team?.fullTimeFounders] as const,
    ["technical", req?.technical, d.team?.technicalCofounder] as const,
  ].filter(([, level]) => level !== undefined);
  if (asks.length === 0) return notApplicableObservation();
  const team = d.team ?? null;
  const facts = { team: team?.summary };
  if (team === null) return unknownObservation(facts);
  const unmet = asks.filter(([, , has]) => has === false);
  const unknown = asks.filter(([, , has]) => has === null || has === undefined);
  if (unmet.some(([, level]) => level === "MUST")) {
    return { ...known("MISMATCH", team.evidenceStatus), facts };
  }
  if (unmet.length > 0)
    return { ...known("PARTIAL", team.evidenceStatus), facts };
  if (unknown.length > 0) return unknownObservation(facts);
  return { ...known("STRONG", team.evidenceStatus), facts };
}

/**
 * Round terms here are lead compatibility: whether the round needs a lead
 * against whether the investor leads. The instrument and terms they STATED
 * (a SAFE, its cap) are named in the sentence when visible, but they never
 * answer the lead question, which stays unknown until it is stated.
 */
function observeRoundTerms(d: DeclaredFitFacts): FitObservation {
  const policy = d.leadPolicy ?? null;
  const terms = d.roundTerms ?? null;
  const facts = { roundTerms: terms?.summary ?? d.statedRound?.terms };
  // Named from what they stated, not from shared round terms.
  const stated = terms === null && d.statedRound?.terms !== undefined;
  // Known terms and the open lead question, shown apart (2026-10-12).
  const items: readonly FitContextItem[] =
    terms?.summary !== undefined
      ? [
          {
            label: "Terms",
            value: terms.summary.slice(0, 60),
            source: "SHARED",
          },
        ]
      : (d.statedRound?.termsItems ?? []);
  const leadOpen =
    policy === null
      ? "Lead: you have not said whether you lead"
      : terms === null || terms.needsLead === null
        ? "Lead investor required: not stated"
        : null;
  const context: FitParameterContext = { items: [...items], open: leadOpen };
  if (policy === null)
    return { ...notApplicableObservation(facts), stated, context };
  if (terms === null || terms.needsLead === null)
    return { ...unknownObservation(facts), stated, context };
  const outcome = !terms.needsLead
    ? "STRONG"
    : policy === "ALWAYS"
      ? "STRONG"
      : policy === "SOMETIMES"
        ? "PARTIAL"
        : "MISMATCH";
  return { ...known(outcome, terms.evidenceStatus), facts, context };
}

function known(
  outcome: "STRONG" | "PARTIAL" | "MISMATCH",
  evidenceStatus: EvidenceStatus | null,
): Omit<FitObservation, "facts"> {
  return { outcome, applicable: true, evidenceStatus, stale: false };
}

const SYMBOLS: Readonly<Record<string, string>> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  NGN: "₦",
  KES: "KSh ",
};

/** "$1.5M", "$250k": short, deterministic, from a decimal string. */
export function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  if (!Number.isFinite(n)) return `${symbol}${amount}`;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (n >= 1_000_000) return `${symbol}${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${symbol}${trim(n / 1_000)}k`;
  return `${symbol}${trim(n)}`;
}
