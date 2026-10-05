import type {
  EvidenceStatus,
  FitHardRuleDto,
  FitParameter,
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

  /** The round as shared with this reader. */
  readonly round?:
    | (DeclaredMoney & { readonly evidenceStatus: EvidenceStatus | null })
    | null
    | undefined;
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

export type ObserveFitInput = {
  readonly companyId: string;
  /** The CURRENT persisted snapshot for this pair, if the ranker made one. */
  readonly snapshot: RecommendationFeatureSnapshot | null;
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

  const observations: Record<FitParameter, FitObservation> = {
    STAGE: fromCategory(
      "declared_fit.stage",
      { MATCH: "STRONG", NO_MATCH: "MISMATCH" },
      { companyStage: d.companyStage, mandateStages: d.mandateStages },
    ),
    SECTOR: fromCategory(
      "declared_fit.taxonomy",
      {
        EXACT_OVERLAP: "STRONG",
        DESCENDANT_OVERLAP: "PARTIAL",
        NO_OVERLAP: "MISMATCH",
      },
      { companySector: d.companySector },
    ),
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
    hardRule: hardRuleFrom(input.eligibilityReasons),
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

function observeCheque(d: DeclaredFitFacts, config: FitConfig): FitObservation {
  const cheque = d.cheque ?? null;
  const ref =
    cheque === null
      ? null
      : (amountOf(cheque.typical) ??
        amountOf(cheque.max) ??
        amountOf(cheque.min));
  if (cheque === null || ref === null) return notApplicableObservation();
  const round = d.round ?? null;
  const roundAmount = amountOf(round?.amount);
  const facts = {
    chequeSize:
      cheque.typical === undefined
        ? undefined
        : formatMoney(cheque.typical, cheque.currency),
    chequeRange:
      cheque.min !== undefined && cheque.max !== undefined
        ? `${formatMoney(cheque.min, cheque.currency)}–${formatMoney(cheque.max, cheque.currency)}`
        : undefined,
    roundSize:
      round === null ? undefined : formatMoney(round.amount, round.currency),
  };
  // No FX: a round in another currency is not comparable, so it is unknown.
  if (
    round === null ||
    roundAmount === null ||
    roundAmount === 0 ||
    round.currency !== cheque.currency
  ) {
    return unknownObservation(facts);
  }
  const share = ref / roundAmount;
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
    facts,
  };
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

function observeRoundTerms(d: DeclaredFitFacts): FitObservation {
  const policy = d.leadPolicy ?? null;
  if (policy === null) return notApplicableObservation();
  const terms = d.roundTerms ?? null;
  const facts = { roundTerms: terms?.summary };
  if (terms === null || terms.needsLead === null)
    return unknownObservation(facts);
  const outcome = !terms.needsLead
    ? "STRONG"
    : policy === "ALWAYS"
      ? "STRONG"
      : policy === "SOMETIMES"
        ? "PARTIAL"
        : "MISMATCH";
  return { ...known(outcome, terms.evidenceStatus), facts };
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
