import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { MoneySchema } from "../common/money.js";
import { UtcTimestampSchema } from "../common/time.js";
import { EvidenceStatusSchema } from "../evidence/vocabulary.js";
import { CompanyRaiseViewSchema } from "./company-raise.js";
import {
  CompanyScoresDtoSchema,
  SUITABILITY_FIT_BANDS,
  SUITABILITY_FIT_CONFIDENCE,
  type ScoreFactor,
  type SuitabilityDto,
  type SuitabilityStatus,
} from "./company-scores.js";

/**
 * Fit with your mandate (founder brief 2026-10-05, B1-B4; ADR 0052).
 *
 * A fit profile answers one question: how well does this company match
 * what THIS investor declared? It is not readiness, not business quality,
 * not interest, not a match and not a relationship state (CLAUDE.md
 * invariants). It is computed by code from a versioned config
 * (`@capital-q/discovery` fit model) and never by a model.
 *
 * What a reader is shown, per ADR 0052: a band in words ("Good fit"), a
 * confidence in words ("Medium confidence"), and for each of nine
 * parameters an outcome (word plus icon) and a reason sentence rendered
 * from a template. No number, no percentage. Unknown is its own outcome:
 * it never counts against a company, it only lowers confidence.
 *
 * Q's view is a separate, labelled Q_INFERENCE. It sits beside the fit and
 * never changes it, the band or any order.
 */

/** The nine parameters, in the order every surface shows them. */
export const FIT_PARAMETERS = [
  "STAGE",
  "SECTOR",
  "GEOGRAPHY",
  "CHEQUE_SIZE",
  "BUSINESS_MODEL",
  "TRACTION",
  "TEAM",
  "THESIS",
  "ROUND_TERMS",
] as const;
export const FitParameterSchema = z.enum(FIT_PARAMETERS);
export type FitParameter = z.infer<typeof FitParameterSchema>;

/** How one parameter fits. UNKNOWN is first-class and never negative. */
export const FIT_OUTCOMES = [
  "STRONG",
  "PARTIAL",
  "MISMATCH",
  "UNKNOWN",
] as const;
export const FitOutcomeSchema = z.enum(FIT_OUTCOMES);
export type FitOutcome = z.infer<typeof FitOutcomeSchema>;

/**
 * The overall band. OUTSIDE_MANDATE only ever comes from a rule the
 * investor declared (a hard exclusion), never from inference; it names the
 * rule. NOT_ENOUGH_INFORMATION is coverage, not a judgement.
 */
export const FIT_BANDS = [
  "STRONG_FIT",
  "GOOD_FIT",
  "PARTIAL_FIT",
  "WEAK_FIT",
  "NOT_ENOUGH_INFORMATION",
  "OUTSIDE_MANDATE",
] as const;
export const FitBandSchema = z.enum(FIT_BANDS);
export type FitBand = z.infer<typeof FitBandSchema>;

/** Confidence in words; never a percentage (CLAUDE.md: no invented confidence). */
export const FIT_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export const FitConfidenceSchema = z.enum(FIT_CONFIDENCE_LEVELS);
export type FitConfidence = z.infer<typeof FitConfidenceSchema>;

/**
 * Where a value shown beside a fit row comes from (2026-10-12). The fit
 * scores only declared inputs; these say what is KNOWN to this reader and
 * from where, so a row never looks empty because scoring cannot use it.
 */
export const FIT_CONTEXT_SOURCES = [
  "PITCH",
  "DECK",
  "PITCH_AND_DECK",
  "SHARED",
  "YOUR_MANDATE",
] as const;
export const FitContextSourceSchema = z.enum(FIT_CONTEXT_SOURCES);
export type FitContextSource = z.infer<typeof FitContextSourceSchema>;

export const FIT_CONTEXT_SOURCE_LABELS: Readonly<
  Record<FitContextSource, string>
> = {
  PITCH: "From pitch",
  DECK: "From deck",
  PITCH_AND_DECK: "From pitch and deck",
  SHARED: "Shared with you",
  YOUR_MANDATE: "Your mandate",
};

export const FitContextItemSchema = z
  .object({
    /** "Raise", "Your cheque", "Instrument", "Valuation cap". */
    label: z.string().min(1).max(40),
    /** The value as stated, e.g. "$4M", "Post-money SAFE". */
    value: z.string().min(1).max(60),
    source: FitContextSourceSchema,
  })
  .strict();
export type FitContextItem = z.infer<typeof FitContextItemSchema>;

export const FitParameterContextSchema = z
  .object({
    /** What is known, each with its source; never scored. */
    items: z.array(FitContextItemSchema).max(6),
    /**
     * What is still open, said separately from what is known: "Ticket fit
     * not scored until the round is formally shared", "Lead investor
     * required: not stated". Null when nothing is.
     */
    open: z.string().min(1).max(120).nullable(),
  })
  .strict();
export type FitParameterContext = z.infer<typeof FitParameterContextSchema>;

/**
 * Why a cheque row is UNKNOWN, as a code (owner 23 Oct 2026: Q invented a
 * reason). Q and the panel state exactly this, never another.
 */
export const FIT_CHEQUE_UNKNOWN_REASONS = [
  /** The company has not shared a round size this reader may see. */
  "ROUND_NOT_SHARED",
  /**
   * Round and cheque are in different currencies and no exchange rate could
   * be had: none stored and none fetched from the internet just now.
   */
  "CURRENCY_DIFFERS_NO_RATE",
] as const;
export const FitChequeUnknownReasonSchema = z.enum(FIT_CHEQUE_UNKNOWN_REASONS);
export type FitChequeUnknownReason = z.infer<
  typeof FitChequeUnknownReasonSchema
>;

/**
 * A cheque comparison made across currencies at a dated reference rate:
 * approximate, an ESTIMATE, never verified (owner 23 Oct 2026).
 */
export const FitEstimateSchema = z
  .object({
    /** The ECB's reference rate, or the public market feed (a currency the ECB does not publish). */
    method: z.enum(["ECB_REFERENCE_RATE", "MARKET_RATE"]),
    /** The date the publisher set the rate for (YYYY-MM-DD). */
    rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    truthClass: z.literal("ESTIMATE"),
  })
  .strict();
export type FitEstimate = z.infer<typeof FitEstimateSchema>;

export const FitParameterResultDtoSchema = z
  .object({
    parameter: FitParameterSchema,
    outcome: FitOutcomeSchema,
    /** One sentence from the config's reason templates. Never model prose. */
    reason: z.string().min(1).max(200),
    /** Evidence behind the company-side input; null when unknown or not applicable. */
    evidenceStatus: EvidenceStatusSchema.nullable(),
    /** The input is older than the config's freshness window. */
    stale: z.boolean(),
    /**
     * False when the investor declared no preference here: the parameter
     * counts toward neither fit nor confidence (outcome is UNKNOWN).
     */
    applicable: z.boolean(),
    /**
     * The reason names what the company STATED where this reader may see
     * it (a pitch, a confirmed deck) but did not formally share: shown as
     * stated, never scored. Only on UNKNOWN rows; absent otherwise.
     */
    stated: z.literal(true).optional(),
    /** Known values beside the row, with their sources (CHEQUE_SIZE, ROUND_TERMS). */
    context: FitParameterContextSchema.optional(),
    /** CHEQUE_SIZE on an UNKNOWN row: the exact reason, as a code. */
    unknownReason: FitChequeUnknownReasonSchema.optional(),
    /** CHEQUE_SIZE compared across currencies: an estimate, and how. */
    estimate: FitEstimateSchema.optional(),
  })
  .strict();
export type FitParameterResultDto = z.infer<typeof FitParameterResultDtoSchema>;

export const FitHardRuleDtoSchema = z
  .object({
    /** Which declared rule: the investor's own exclusion, by dimension. */
    code: z.enum([
      "EXCLUDED_SECTOR",
      "EXCLUDED_GEOGRAPHY",
      "STAGE_OUTSIDE_STRICT_RANGE",
      "DECLARED_EXCLUSION",
    ]),
    /** The rule in words, from a template. */
    label: z.string().min(1).max(200),
  })
  .strict();
export type FitHardRuleDto = z.infer<typeof FitHardRuleDtoSchema>;

export const FitProfileDtoSchema = z
  .object({
    companyId: UuidSchema,
    /** The fit config that produced this profile, e.g. `ranking-config.v4`. */
    configVersion: z.string().min(1).max(64),
    /** Short for people: "4" in "Fit rules version 4". */
    configLabel: z.string().min(1).max(16),
    band: FitBandSchema,
    confidence: FitConfidenceSchema,
    /** Exactly the nine parameters, in FIT_PARAMETERS order. */
    parameters: z
      .array(FitParameterResultDtoSchema)
      .length(FIT_PARAMETERS.length),
    /** Up to three strongest reasons, best first. */
    topReasons: z.array(FitParameterResultDtoSchema).max(3),
    /** The main mismatch, if any. Never an unknown. */
    mainMismatch: FitParameterResultDtoSchema.nullable(),
    /** Set only when a declared hard rule excludes the company. */
    hardRule: FitHardRuleDtoSchema.nullable(),
    computedAt: UtcTimestampSchema,
  })
  .strict();
export type FitProfileDto = z.infer<typeof FitProfileDtoSchema>;

/** A company's fit with the reader's mandate, with what the reader may see of it. */
export const FitCompanyDtoSchema = z
  .object({
    companyId: UuidSchema,
    name: z.string().min(1).max(200),
    /** "Seed · Kenya"; null when nothing is known. */
    line: z.string().max(200).nullable(),
    profile: FitProfileDtoSchema,
    /**
     * 2026-10-16: Investability and Suitability (company-scores.ts), two
     * separate scores. Absent from an older server.
     */
    scores: CompanyScoresDtoSchema.optional(),
  })
  .strict();
export type FitCompanyDto = z.infer<typeof FitCompanyDtoSchema>;

export const FitProfileListDtoSchema = z
  .object({
    items: z.array(FitCompanyDtoSchema).max(50),
  })
  .strict();
export type FitProfileListDto = z.infer<typeof FitProfileListDtoSchema>;

// ---------------------------------------------------------------------------
// Q's view (separate, labelled, never changes fit)
// ---------------------------------------------------------------------------

export const Q_VIEW_VERDICTS = [
  "WORTH_A_LOOK",
  "MAYBE",
  "PROBABLY_NOT",
] as const;
export const QViewVerdictSchema = z.enum(Q_VIEW_VERDICTS);
export type QViewVerdict = z.infer<typeof QViewVerdictSchema>;

export const QViewDtoSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("READY"),
      companyId: UuidSchema,
      verdict: QViewVerdictSchema,
      /** Two or three reasons, in Q's words. */
      summary: z.string().min(1).max(400),
      mainRisk: z.string().max(200).nullable(),
      /** What Q would ask about because it is not known. */
      unknowns: z.array(z.string().min(1).max(160)).max(3),
      /** Always an inference; never evidence, never verified. */
      truthClass: z.literal("Q_INFERENCE"),
      /** The fit config the view was formed beside (it never altered it). */
      configVersion: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      companyId: UuidSchema,
    })
    .strict(),
]);
export type QViewDto = z.infer<typeof QViewDtoSchema>;

// ---------------------------------------------------------------------------
// Top N side by side (B2)
// ---------------------------------------------------------------------------

/** Where a candidate came from: only the investor's own lists. */
export const FIT_CANDIDATE_SOURCES = [
  "RELATIONSHIP",
  "REQUEST",
  "FEED",
  /** Q.10: a company the investor picked from Saved to compare. */
  "SAVED",
] as const;
export const FitCandidateSourceSchema = z.enum(FIT_CANDIDATE_SOURCES);
export type FitCandidateSource = z.infer<typeof FitCandidateSourceSchema>;

export const FIT_COMPARISON_MAX = 10;

export const FitComparisonEntryDtoSchema = z
  .object({
    /** 1-based position under the fit config's ordering. */
    position: z.number().int().min(1).max(FIT_COMPARISON_MAX),
    companyId: UuidSchema,
    name: z.string().min(1).max(200),
    /** "Seed · Clean energy · Nairobi"; only what this reader may see. */
    line: z.string().max(200).nullable(),
    /** What the company does, in its own one line; absent from an older server. */
    about: z.string().max(400).nullable().optional(),
    /** The current raise, only where disclosure lets this reader see it. */
    raise: MoneySchema.nullable().optional(),
    /**
     * R2: the raise as this reader sees it on every surface (`raiseFor`),
     * for display. `raise` above stays the disclosed objective the fit
     * itself was computed from. Absent where no reader is composed.
     */
    raiseView: CompanyRaiseViewSchema.optional(),
    sources: z.array(FitCandidateSourceSchema).min(1).max(3),
    profile: FitProfileDtoSchema,
    /** 2026-10-16: Investability and Suitability; absent from an older server. */
    scores: CompanyScoresDtoSchema.optional(),
    /** Rows where this entry is the best of the set (shown with a word, never colour alone). */
    bestOn: z.array(FitParameterSchema).max(FIT_PARAMETERS.length),
  })
  .strict();
export type FitComparisonEntryDto = z.infer<typeof FitComparisonEntryDtoSchema>;

export const FitComparisonDtoSchema = z
  .object({
    configVersion: z.string().min(1).max(64),
    configLabel: z.string().min(1).max(16),
    /** Row order for every column. */
    parameters: z.array(FitParameterSchema).length(FIT_PARAMETERS.length),
    entries: z.array(FitComparisonEntryDtoSchema).max(FIT_COMPARISON_MAX),
    /** How many of the investor's own candidates were considered. */
    considered: z.number().int().min(0),
    /** Left out, and why ("Why these three?"). Counts only, no names. */
    leftOut: z
      .object({
        outsideMandate: z.number().int().min(0),
        notEnoughInformation: z.number().int().min(0),
      })
      .strict(),
    computedAt: UtcTimestampSchema,
  })
  .strict();
export type FitComparisonDto = z.infer<typeof FitComparisonDtoSchema>;

/** `GET /v1/fit/companies?ids=a,b` — the reader's own fit with each company. */
export const FIT_COMPANIES_PATH = "/v1/fit/companies" as const;
/** `GET /v1/fit/companies/:companyId`. */
export const FIT_COMPANY_PATH = "/v1/fit/companies/:companyId" as const;
/** `GET /v1/fit/companies/:companyId/q-view` — Q's view, off the critical path. */
export const FIT_Q_VIEW_PATH = "/v1/fit/companies/:companyId/q-view" as const;
/** `GET /v1/fit/top?limit=3` — the reader's own candidates, side by side. */
export const FIT_TOP_PATH = "/v1/fit/top" as const;

export const FIT_IDS_MAX = 50;

/**
 * `GET /v1/fit/compare?ids=a,b` — Q.10: 2 to 4 companies the investor
 * picked (from Saved), side by side, on the same fit and words as the top
 * three. Each id is re-checked for visibility; one the reader may not see
 * is simply absent. Their order is the fit order, never the request's.
 */
export const FIT_COMPARE_PATH = "/v1/fit/compare" as const;
export const FIT_COMPARE_MIN = 2;
export const FIT_COMPARE_MAX = 4;

export const FitCompareQuerySchema = z
  .object({
    ids: z
      .string()
      .max(FIT_COMPARE_MAX * 37)
      .transform((value) => [
        ...new Set(value.split(",").filter((id) => id.length > 0)),
      ])
      .pipe(z.array(UuidSchema).min(FIT_COMPARE_MIN).max(FIT_COMPARE_MAX)),
  })
  .strict();

export const FitCompaniesQuerySchema = z
  .object({
    ids: z
      .string()
      .max(FIT_IDS_MAX * 37)
      .transform((value) => value.split(",").filter((id) => id.length > 0))
      .pipe(z.array(UuidSchema).min(1).max(FIT_IDS_MAX)),
  })
  .strict();

export const FitTopQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(FIT_COMPARISON_MAX).default(3),
  })
  .strict();

// ---------------------------------------------------------------------------
// Words (ADR 0052: every score is shown as words; one vocabulary everywhere)
// ---------------------------------------------------------------------------

export const FIT_BAND_LABELS: Readonly<Record<FitBand, string>> = {
  STRONG_FIT: "Strong fit",
  GOOD_FIT: "Good fit",
  PARTIAL_FIT: "Partial fit",
  WEAK_FIT: "Weak fit",
  NOT_ENOUGH_INFORMATION: "Not enough information",
  OUTSIDE_MANDATE: "Outside your mandate",
};

/**
 * ADR 0059: fit shown as a score out of 10 beside its band in words, the
 * same scale as Q's answer cards (ADR 0053). Derived only from the outcomes
 * the reader already sees: STRONG 10, PARTIAL 4, MISMATCH 0, UNKNOWN left
 * out. No score when a declared rule excludes the company or too little is
 * known, so absence never reads as a low number. Never a percentage.
 */
const FIT_SCORE_POINTS: Readonly<Record<FitOutcome, number | null>> = {
  STRONG: 10,
  PARTIAL: 4,
  MISMATCH: 0,
  UNKNOWN: null,
};

export function fitScoreOutOf10(profile: {
  readonly band: FitBand;
  readonly parameters: readonly { readonly outcome: FitOutcome }[];
}): string | null {
  if (profile.band === "OUTSIDE_MANDATE") return null;
  if (profile.band === "NOT_ENOUGH_INFORMATION") return null;
  const known = profile.parameters
    .map((parameter) => FIT_SCORE_POINTS[parameter.outcome])
    .filter((points): points is number => points !== null);
  if (known.length < 3) return null;
  const mean = known.reduce((sum, points) => sum + points, 0) / known.length;
  return (Math.round(mean * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

export const FIT_CONFIDENCE_LABELS: Readonly<Record<FitConfidence, string>> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
};

export const FIT_PARAMETER_LABELS: Readonly<Record<FitParameter, string>> = {
  STAGE: "Stage",
  SECTOR: "Sector",
  GEOGRAPHY: "Geography",
  // The raise is the round, not anyone's cheque: this row compares the
  // investor's own cheque with the round (2026-10-12).
  CHEQUE_SIZE: "Cheque compatibility",
  BUSINESS_MODEL: "Business model",
  TRACTION: "Traction",
  TEAM: "Team",
  THESIS: "Thesis",
  ROUND_TERMS: "Round terms",
};

export const FIT_OUTCOME_LABELS: Readonly<Record<FitOutcome, string>> = {
  STRONG: "Strong match",
  PARTIAL: "Partial",
  MISMATCH: "Mismatch",
  UNKNOWN: "Unknown",
};

/** The word for a parameter the investor declared no preference on. */
export const FIT_NOT_APPLICABLE_LABEL = "No preference";

/**
 * The word for an UNKNOWN row whose reason names what the company stated
 * where the reader may see it (`stated`): known from them, not scored.
 */
export const FIT_STATED_LABEL = "Stated";

export const Q_VIEW_VERDICT_LABELS: Readonly<Record<QViewVerdict, string>> = {
  WORTH_A_LOOK: "Worth a look",
  MAYBE: "Maybe",
  PROBABLY_NOT: "Probably not",
};

// ---------------------------------------------------------------------------
// Suitability (2026-10-16): the fit as a 0-100 score (company-scores.ts)
// ---------------------------------------------------------------------------

// The two vocabularies must stay identical, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _bandsAgree: Same<FitBand, (typeof SUITABILITY_FIT_BANDS)[number]> = true;
const _confidenceAgree: Same<
  FitConfidence,
  (typeof SUITABILITY_FIT_CONFIDENCE)[number]
> = true;
void _bandsAgree;
void _confidenceAgree;

/**
 * Suitability from the fit profile the reader already sees: the same
 * outcomes and the same score (fitScoreOutOf10 × 10), so the two can never
 * disagree. Deterministic; no model; unknown rows are coverage, never a
 * low score.
 */
export function suitabilityFromFit(profile: FitProfileDto): SuitabilityDto {
  const applicable = profile.parameters.filter((p) => p.applicable);
  const known = applicable.filter((p) => p.outcome !== "UNKNOWN");
  // ADR 0075: a number whenever anything is known, labelled with its
  // coverage; the fit's own x/10 (3+ known) is used when it shows one, so
  // the two agree wherever both are shown.
  const points = known
    .map((p) => FIT_SCORE_POINTS[p.outcome])
    .filter((n): n is number => n !== null);
  const shownFit = fitScoreOutOf10(profile);
  const shown =
    shownFit ??
    (points.length === 0
      ? null
      : String(
          Math.round(
            (points.reduce((sum, n) => sum + n, 0) / points.length) * 10,
          ) / 10,
        ));
  const status: SuitabilityStatus =
    profile.band === "OUTSIDE_MANDATE"
      ? "OUTSIDE_MANDATE"
      : shown === null
        ? "NOT_ENOUGH_INFORMATION"
        : "SCORED";
  const factor = (p: FitParameterResultDto): ScoreFactor => ({
    label: FIT_PARAMETER_LABELS[p.parameter],
    detail: p.reason,
  });
  const up = [
    ...applicable.filter((p) => p.outcome === "STRONG"),
    ...applicable.filter((p) => p.outcome === "PARTIAL"),
  ]
    .slice(0, 3)
    .map(factor);
  const down: ScoreFactor[] = [];
  if (profile.hardRule !== null) {
    down.push({ label: "Declared rule", detail: profile.hardRule.label });
  }
  for (const p of applicable) {
    if (p.outcome === "MISMATCH" && down.length < 3) down.push(factor(p));
  }
  const missing = applicable
    .filter((p) => p.outcome === "UNKNOWN")
    .slice(0, 4)
    .map((p) => `${FIT_PARAMETER_LABELS[p.parameter]}: not known yet`);
  return {
    status,
    score:
      status === "SCORED" && shown !== null
        ? Math.round(Number(shown) * 10)
        : null,
    band: profile.band,
    confidence: profile.confidence,
    coverage: { known: known.length, applicable: applicable.length },
    up,
    down,
    missing,
    configVersion: profile.configVersion,
  };
}
