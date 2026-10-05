import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { EvidenceStatusSchema } from "../evidence/vocabulary.js";

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

export const FitProfileListDtoSchema = z
  .object({
    items: z.array(FitProfileDtoSchema).max(50),
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
    sources: z.array(FitCandidateSourceSchema).min(1).max(3),
    profile: FitProfileDtoSchema,
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

export const FIT_CONFIDENCE_LABELS: Readonly<Record<FitConfidence, string>> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
};

export const FIT_PARAMETER_LABELS: Readonly<Record<FitParameter, string>> = {
  STAGE: "Stage",
  SECTOR: "Sector",
  GEOGRAPHY: "Geography",
  CHEQUE_SIZE: "Cheque size",
  BUSINESS_MODEL: "Business model",
  TRACTION: "Traction",
  TEAM: "Team",
  THESIS: "Thesis",
  ROUND_TERMS: "Round",
};

export const FIT_OUTCOME_LABELS: Readonly<Record<FitOutcome, string>> = {
  STRONG: "Strong match",
  PARTIAL: "Partial",
  MISMATCH: "Mismatch",
  UNKNOWN: "Unknown",
};

/** The word for a parameter the investor declared no preference on. */
export const FIT_NOT_APPLICABLE_LABEL = "No preference";

export const Q_VIEW_VERDICT_LABELS: Readonly<Record<QViewVerdict, string>> = {
  WORTH_A_LOOK: "Worth a look",
  MAYBE: "Maybe",
  PROBABLY_NOT: "Probably not",
};
