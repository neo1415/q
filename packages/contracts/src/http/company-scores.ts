import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { UnicornPotentialDtoSchema } from "./unicorn-potential.js";

/**
 * The two scores every company carries for an investor (owner request
 * 2026-10-16: "so the investor knows what is worth his time").
 *
 *   Investability  how investable the company is on its evidence (FDN
 *                  InvestIQ, docs/ai-handoff/INVESTIQ-METHODOLOGY.md):
 *                  business quality and readiness, from what the company
 *                  shared with the network and what is verified. One value
 *                  per company, the same for every investor, computed only
 *                  from investor-eligible information (Context Firewall).
 *   Suitability    how well the company fits THIS investor's declared
 *                  mandate: the "Fit with you" profile as a score.
 *
 * They are separate scores and are never blended into one shown number
 * (CLAUDE.md: Readiness ≠ Business Quality ≠ Fit). Both are computed by
 * code from versioned configs, never by a model. Unknown stays unknown:
 * missing evidence lowers coverage and confidence, never the score, and
 * too little evidence shows no number at all. Every score carries its
 * coverage ("based on 5 of 8 areas") and a confidence in words.
 */

/**
 * The fit vocabulary, repeated here so this module never imports fit.ts at
 * runtime (fit.ts imports it; an ESM cycle would read these before they
 * exist). fit.ts asserts at the type level that both lists are identical.
 */
export const SUITABILITY_FIT_BANDS = [
  "STRONG_FIT",
  "GOOD_FIT",
  "PARTIAL_FIT",
  "WEAK_FIT",
  "NOT_ENOUGH_INFORMATION",
  "OUTSIDE_MANDATE",
] as const;
export const SUITABILITY_FIT_CONFIDENCE = ["HIGH", "MEDIUM", "LOW"] as const;

export const SCORE_CONFIDENCE_LEVELS = ["HIGH", "MODERATE", "LOW"] as const;
export const ScoreConfidenceSchema = z.enum(SCORE_CONFIDENCE_LEVELS);
export type ScoreConfidence = z.infer<typeof ScoreConfidenceSchema>;

export const SCORE_CONFIDENCE_LABELS: Readonly<
  Record<ScoreConfidence, string>
> = {
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
};

/** One line of "why": a factor that raised or lowered the score. */
export const ScoreFactorSchema = z
  .object({
    /** "Traction", "Founder quality". */
    label: z.string().min(1).max(80),
    /** "Dated figures in the confirmed deck · self-reported". */
    detail: z.string().min(1).max(200),
  })
  .strict();
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

const WhySchema = {
  /** Strongest factors that raised the score, best first. */
  up: z.array(ScoreFactorSchema).max(3),
  /** Factors that lowered it, or withheld it (contradictions). */
  down: z.array(ScoreFactorSchema).max(3),
  /** What would raise coverage or confidence, most valuable first. */
  missing: z.array(z.string().min(1).max(160)).max(4),
};

// ---------------------------------------------------------------------------
// Investability (FDN InvestIQ)
// ---------------------------------------------------------------------------

/** Investor-facing words for the InvestIQ band (0-100 = InvestIQ 0-4 × 25). */
export const INVESTABILITY_BANDS = [
  "STRONG",
  "INVESTABLE",
  "DEVELOPING",
  "EARLY",
] as const;
export const InvestabilityBandSchema = z.enum(INVESTABILITY_BANDS);
export type InvestabilityBand = z.infer<typeof InvestabilityBandSchema>;

export const INVESTABILITY_BAND_LABELS: Readonly<
  Record<InvestabilityBand, string>
> = {
  STRONG: "Strong",
  INVESTABLE: "Investable",
  DEVELOPING: "Developing",
  EARLY: "Not yet investable",
};

export const INVESTABILITY_STATUSES = [
  /** Enough evidence across enough areas: a score is shown. */
  "SCORED",
  /** Assessed, but too little is known to show a number. Never "poor". */
  "INSUFFICIENT_EVIDENCE",
  /** Not assessed yet (new, or not listed to the network). */
  "NOT_ASSESSED",
  /**
   * ADR 0075: nothing investor-visible to read (no deck, no pitch, no
   * shared claims). The only state that shows no number once assessed.
   */
  "NO_MATERIAL",
] as const;
export const InvestabilityStatusSchema = z.enum(INVESTABILITY_STATUSES);
export type InvestabilityStatus = z.infer<typeof InvestabilityStatusSchema>;

/** One part of Investability: a number only with enough graded evidence. */
export const InvestabilityPartSchema = z
  .object({
    score: z.number().int().min(0).max(100).nullable(),
    band: InvestabilityBandSchema.nullable(),
    confidence: ScoreConfidenceSchema.nullable(),
    /** Factors of this part on record, of those that apply. */
    factors: z
      .object({
        onRecord: z.number().int().min(0).max(200),
        applicable: z.number().int().min(0).max(200),
      })
      .strict(),
  })
  .strict();
export type InvestabilityPart = z.infer<typeof InvestabilityPartSchema>;

/**
 * Plain names and one sentence each (owner decision 78): the same words on
 * every screen and in Q's answers.
 */
export const INVESTABILITY_PARTS = [
  {
    key: "businessQuality",
    name: "Business quality",
    sentence:
      "How strong the business looks: the team, the product and market, traction and finances.",
  },
  {
    key: "readiness",
    name: "Investment readiness",
    sentence:
      "How prepared it is for investors: governance, legal basics, the raise and diligence.",
  },
] as const;

export const InvestabilityDtoSchema = z
  .object({
    status: InvestabilityStatusSchema,
    /** 0-100, integer; null unless SCORED. */
    score: z.number().int().min(0).max(100).nullable(),
    band: InvestabilityBandSchema.nullable(),
    confidence: ScoreConfidenceSchema.nullable(),
    /** The band was held at DEVELOPING because confidence is low. */
    cappedByConfidence: z.boolean(),
    /**
     * ADR 0075: shown on a basis thinner than InvestIQ's full coverage gates
     * (a screening signal); confidence is then Low. Absent: false.
     */
    provisional: z.boolean().optional(),
    /**
     * Lead 2026-10-16: the evidence range around the score, 0-100. Weak
     * (self-reported, unconfirmed) evidence widens it; verified evidence
     * narrows it. It never moves the score itself. Absent: not computed.
     */
    range: z
      .object({
        low: z.number().int().min(0).max(100),
        high: z.number().int().min(0).max(100),
      })
      .strict()
      .optional(),
    coverage: z
      .object({
        /** InvestIQ dimensions with enough evidence to score. */
        areasScored: z.number().int().min(0).max(16),
        areasTotal: z.number().int().min(0).max(16),
        criteriaScored: z.number().int().min(0).max(200),
        criteriaApplicable: z.number().int().min(0).max(200),
      })
      .strict(),
    /** "Seed", or null when the stage is unknown. */
    stage: z.string().min(1).max(40).nullable(),
    /**
     * PADL #060-#062, owner decision 78 (audit P1-7): the two parts of the
     * headline, each scored the same way over its own dimensions. Absent on
     * assessments recorded before investability-inputs.v6.
     */
    parts: z
      .object({
        businessQuality: InvestabilityPartSchema,
        readiness: InvestabilityPartSchema,
      })
      .strict()
      .optional(),
    ...WhySchema,
    /** e.g. `investiq/v1+investability-inputs.v1`. */
    methodVersion: z.string().min(1).max(80),
    assessedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type InvestabilityDto = z.infer<typeof InvestabilityDtoSchema>;

/**
 * The method's public name from the version that produced the score
 * (metrics audit P1-6: the label said v1 over v2 arithmetic), e.g.
 * `investiq/v2+investability-inputs.v5` -> "FDN InvestIQ v2".
 */
/**
 * The Investability method new assessments are recorded under, for
 * surfaces that cannot import the scoring package (the browser). The
 * readiness package's INVESTABILITY_METHOD_VERSION must equal it (tested).
 */
export const INVESTABILITY_CURRENT_METHOD_VERSION =
  "investiq/v3+investability-inputs.v6";

export function investabilityMethodLabel(methodVersion: string): string {
  const major = /^investiq\/v(\d+)/u.exec(methodVersion)?.[1];
  return major === undefined ? "FDN InvestIQ" : `FDN InvestIQ v${major}`;
}

export function notAssessedInvestability(
  methodVersion: string,
): InvestabilityDto {
  return {
    status: "NOT_ASSESSED",
    score: null,
    band: null,
    confidence: null,
    cappedByConfidence: false,
    coverage: {
      areasScored: 0,
      areasTotal: 0,
      criteriaScored: 0,
      criteriaApplicable: 0,
    },
    stage: null,
    up: [],
    down: [],
    missing: [],
    methodVersion,
    assessedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Suitability (fit with this investor's mandate)
// ---------------------------------------------------------------------------

export const SUITABILITY_STATUSES = [
  "SCORED",
  "NOT_ENOUGH_INFORMATION",
  /** A rule the investor declared excludes it; never inferred. */
  "OUTSIDE_MANDATE",
] as const;
export const SuitabilityStatusSchema = z.enum(SUITABILITY_STATUSES);
export type SuitabilityStatus = z.infer<typeof SuitabilityStatusSchema>;

export const SuitabilityDtoSchema = z
  .object({
    status: SuitabilityStatusSchema,
    /** 0-100, integer: the fit shown out of 10, × 10. Null unless SCORED. */
    score: z.number().int().min(0).max(100).nullable(),
    band: z.enum(SUITABILITY_FIT_BANDS),
    /** The fit confidence words (HIGH, MEDIUM, LOW). */
    confidence: z.enum(SUITABILITY_FIT_CONFIDENCE),
    coverage: z
      .object({
        /** Mandate parameters where the company side is known. */
        known: z.number().int().min(0).max(16),
        /** Parameters the investor declared a preference on. */
        applicable: z.number().int().min(0).max(16),
      })
      .strict(),
    ...WhySchema,
    configVersion: z.string().min(1).max(64),
  })
  .strict();
export type SuitabilityDto = z.infer<typeof SuitabilityDtoSchema>;

// ---------------------------------------------------------------------------
// Both, per company
// ---------------------------------------------------------------------------

export const CompanyScoresDtoSchema = z
  .object({
    companyId: UuidSchema,
    investability: InvestabilityDtoSchema,
    /** Null for a reader with no mandate (or not an investor). */
    suitability: SuitabilityDtoSchema.nullable(),
    /** Absent unless server-side premium and company visibility both allow. */
    unicornPotential: UnicornPotentialDtoSchema.optional(),
  })
  .strict();
export type CompanyScoresDto = z.infer<typeof CompanyScoresDtoSchema>;

/** "Investability 72 · based on 5 of 8 areas", or the honest words. */
export function investabilityLine(dto: InvestabilityDto): string {
  if (dto.status === "NOT_ASSESSED") return "Investability not assessed yet";
  if (dto.status === "NO_MATERIAL") return "No pitch or deck shared yet";
  const factors = `based on ${dto.coverage.criteriaScored} of ${dto.coverage.criteriaApplicable} factors`;
  if (dto.status === "INSUFFICIENT_EVIDENCE" || dto.score === null) {
    return `Investability: not enough shared evidence yet · ${factors}`;
  }
  // One compact indicator per score (owner decision 76; audit P2-4).
  const confidence =
    dto.confidence === null
      ? ""
      : ` · ${SCORE_CONFIDENCE_LABELS[dto.confidence]}`;
  return `Investability ${dto.score}${confidence} · ${factors}`;
}

/**
 * "Business quality 68 · Developing · Low confidence", or "Business
 * quality: not enough evidence yet". Null when the parts were not recorded.
 */
export function investabilityPartLines(dto: InvestabilityDto): string[] | null {
  if (dto.parts === undefined) return null;
  const parts = dto.parts;
  return INVESTABILITY_PARTS.map(({ key, name }) => {
    const part = parts[key];
    if (part.score === null || part.band === null) {
      return part.factors.onRecord === 0
        ? `${name}: nothing shared yet`
        : `${name}: ${String(part.factors.onRecord)} of ${String(part.factors.applicable)} factors on record, not enough to grade yet`;
    }
    const confidence =
      part.confidence === null
        ? ""
        : ` · ${SCORE_CONFIDENCE_LABELS[part.confidence]}`;
    return `${name} ${String(part.score)} · ${INVESTABILITY_BAND_LABELS[part.band]}${confidence}`;
  });
}

/** "Suitability 80 · 6 of 7 known", or the honest words. */
export function suitabilityLine(dto: SuitabilityDto): string {
  if (dto.status === "OUTSIDE_MANDATE")
    return "Suitability: outside your mandate";
  const known = `${dto.coverage.known} of ${dto.coverage.applicable} known`;
  if (dto.status === "NOT_ENOUGH_INFORMATION" || dto.score === null) {
    return `Suitability: not enough known yet · ${known}`;
  }
  return `Suitability ${dto.score} · ${known}`;
}
