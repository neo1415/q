import { z } from "zod";

import { QConfidenceLevelSchema } from "@capital-q/contracts";

import {
  LIST_MAX,
  ModelStatementSchema,
  TaskFrameSchema,
  TEXT_MAX,
} from "./common.js";

/**
 * FIT_EXPLANATION (CQ-Q-006 §32). Explain an EXISTING deterministic
 * company-investor fit result. The factors are supplied by the
 * recommendation model; the prompt reads them and explains, it never
 * re-ranks, re-scores, or invents a probability.
 *
 *   Fit ≠ Interest ≠ Investment Probability ≠ Company Quality
 */

export const FIT_FACTOR_OUTCOMES = [
  "MATCHED",
  "PARTIAL",
  "NOT_MATCHED",
  "UNKNOWN",
] as const;
export const FitFactorOutcomeSchema = z.enum(FIT_FACTOR_OUTCOMES);

/** One deterministic factor as the recommendation model produced it. Data. */
export const FitFactorSchema = z
  .object({
    factor: z.string().min(1).max(120),
    kind: z.enum(["HARD_CONSTRAINT", "SOFT_PREFERENCE"]),
    outcome: FitFactorOutcomeSchema,
    /** The rule's own wording of why, if it gave one. */
    detail: z.string().max(600).optional(),
    /** Evidence quality behind the company-side value, in Capital Q's vocabulary. */
    evidenceStatus: z.string().max(40).optional(),
  })
  .strict();

export const FitExplanationVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** Deterministic factors, as computed. UNTRUSTED data (it is content, not instruction). */
    factors: z.array(FitFactorSchema).min(1).max(40),
    /** Overall label the deterministic model assigned, if any, e.g. "STRONG_FIT". Data. */
    overallFit: z.string().max(60).nullable(),
    /** Who is asking: the investor about the company, or the founder about the investor. */
    audience: z.enum(["INVESTOR", "FOUNDER"]),
    /** Plain descriptions, trusted. */
    companyDescription: z.string().max(400),
    investorDescription: z.string().max(400),
    /** Current relationship state if known, e.g. "no relationship", "meeting requested". Data. */
    relationshipState: z.string().max(120).nullable(),
  })
  .strict();
export type FitExplanationVariables = z.infer<
  typeof FitExplanationVariablesSchema
>;

export const FIT_EXPLANATION_UNTRUSTED = [
  "factors",
  "overallFit",
  "relationshipState",
] as const;

export const FitExplanationResultSchema = z
  .object({
    /** The explanation the person reads. */
    explanation: z.string().trim().min(1).max(TEXT_MAX),
    matched: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    notMatched: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    hardConstraintsFailed: z
      .array(ModelStatementSchema)
      .max(LIST_MAX)
      .default([]),
    unknowns: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    confidence: QConfidenceLevelSchema,
    /** Must restate the supplied label or null; never a new label. */
    overallFitRestated: z.string().max(60).nullable(),
  })
  .strict();
export type FitExplanationResult = z.infer<typeof FitExplanationResultSchema>;

export const FIT_EXPLANATION_SCHEMA_NAME = "FitExplanationResult";
export const FIT_EXPLANATION_SCHEMA_VERSION = 1;
