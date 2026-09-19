import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";

import { RankingReasonCodeSchema } from "../ranking/config.js";

/**
 * Why an investor is seeing a company (doc 19 §56–§58, §188; CQ-REC-007).
 *
 *   ranking engine  filters, generates, scores, orders
 *   explanation     says which declared criteria matched, which did not,
 *                   and what remains unknown
 *   Q               phrases that naturally (REC-007 C), and nothing more
 *
 * The explanation is derived from the SAME factors that produced the
 * ordering — the item's own feature snapshot, replayed through the ranking
 * config the slate recorded — so it can never be a post-hoc story about a
 * decision made another way. Doc 19 §56 is explicit that "strong match
 * because your fund invests Seed B2B payments across Africa, and this
 * company is Seed, Nigeria-based" beats "87% match": no internal score,
 * weight or similarity reaches a reader here.
 */

export const EXPLANATION_VERSION = "recommendation-explanation.v1" as const;

/** The declared dimensions a V1 explanation can speak about. */
export const EXPLANATION_DIMENSIONS = [
  "STAGE",
  "GEOGRAPHY",
  "TAXONOMY",
  "SEMANTIC",
  "CHEQUE",
] as const;
export const ExplanationDimensionSchema = z.enum(EXPLANATION_DIMENSIONS);
export type ExplanationDimension = z.infer<typeof ExplanationDimensionSchema>;

/**
 * What the dimension did. MATCH and PARTIAL are alignment of different
 * strength; MISMATCH is a declared criterion this company does not meet;
 * UNKNOWN and NOT_APPLICABLE are the absence of evidence, which doc 19 §92
 * forbids treating as a negative.
 */
export const EXPLANATION_OUTCOMES = [
  "MATCH",
  "PARTIAL",
  "MISMATCH",
  "UNKNOWN",
  "NOT_APPLICABLE",
] as const;
export const ExplanationOutcomeSchema = z.enum(EXPLANATION_OUTCOMES);
export type ExplanationOutcome = z.infer<typeof ExplanationOutcomeSchema>;

export const ExplanationFactorSchema = z
  .object({
    dimension: ExplanationDimensionSchema,
    outcome: ExplanationOutcomeSchema,
    /** Plain English, bounded, composed from the dimension and outcome. */
    label: z.string().min(1).max(160),
    /** The ranker's own code for this factor: the audit link back to REC-005. */
    reasonCode: RankingReasonCodeSchema,
  })
  .strict();
export type ExplanationFactor = z.infer<typeof ExplanationFactorSchema>;

export const RecommendationExplanationSchema = z
  .object({
    explanationVersion: z.literal(EXPLANATION_VERSION),
    slateId: UuidSchema,
    companyId: UuidSchema,
    /** Position in the slate this explanation belongs to. Not a verdict. */
    rank: z.number().int().min(1),
    /** Plain English. Deterministic unless `source` says Q phrased it. */
    summary: z.string().min(1).max(1200),
    matchedFactors: z.array(ExplanationFactorSchema).max(8),
    mismatchedFactors: z.array(ExplanationFactorSchema).max(8),
    uncertainties: z.array(ExplanationFactorSchema).max(8),
    /**
     * The ranking that produced the item being explained, not today's
     * (doc 19 §55, §189). An old recommendation is explained by the
     * versions it was built under or it is not explained at all.
     */
    generatedFromRankingVersion: z.string().min(1).max(128),
    /**
     * DETERMINISTIC is the whole explanation, built without any model.
     * Q_SYNTHESIZED means a model phrased the same factors; the factor
     * arrays are identical either way.
     */
    source: z.enum(["DETERMINISTIC", "Q_SYNTHESIZED"]),
  })
  .strict();
export type RecommendationExplanation = z.infer<
  typeof RecommendationExplanationSchema
>;

/** Why an explanation could not be produced. Bounded; never a stack. */
export const EXPLANATION_REFUSALS = [
  /** No such item in a slate this actor may read. Absent and forbidden look alike. */
  "NOT_FOUND",
  /** The item's feature snapshot is gone or no longer matches its fingerprint. */
  "SNAPSHOT_UNAVAILABLE",
  /**
   * The slate was built by a ranking config this build no longer carries.
   * Explaining it with today's config would describe a decision that was
   * never made, so it is refused instead (doc 19 §55).
   */
  "RANKING_VERSION_UNAVAILABLE",
] as const;
export const ExplanationRefusalSchema = z.enum(EXPLANATION_REFUSALS);
export type ExplanationRefusal = z.infer<typeof ExplanationRefusalSchema>;

export type ExplainResult =
  | {
      readonly kind: "EXPLAINED";
      readonly explanation: RecommendationExplanation;
    }
  | { readonly kind: "REFUSED"; readonly refusal: ExplanationRefusal };
