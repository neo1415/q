import { z } from "zod";

import {
  FEATURE_SCHEMA_VERSION,
  FeatureGroupSchema,
  FeatureIdSchema,
  FeatureMissingReasonSchema,
  FeatureSourceClassSchema,
  FeatureValueStatusSchema,
  FeatureVersionSchema,
  SnapshotCandidateProvenanceSchema,
} from "../features/contracts.js";
import { FactorPolaritySchema, RankingReasonCodeSchema } from "./config.js";

/**
 * Ranked candidates (doc 19 §52, §108, §112; CQ-REC-005 §28–§30, §43).
 *
 *   rank score ≠ probability ≠ quality ≠ public Capital Q score
 *   factor result ≠ explanation prose (REC-007)
 *   ranker ≠ slate (REC-006)
 *
 * The internal score is ordering data inside one ranking config and one
 * candidate pool. It is never shown, never compared across configs and
 * never read as the likelihood of anything.
 */

/** Doc 19 §108: the ranker's identity, separate from its config. */
export const RANKER_ID = "DETERMINISTIC" as const;
/** Bumped when the ranking algorithm (not its configuration) changes. */
export const RANKER_VERSION = "deterministic-ranker.v1" as const;

/** How a factor fared for one candidate. */
export const FACTOR_OUTCOMES = [
  /** PRESENT and mapped: contributed to the score. */
  "SCORED",
  /** MISSING: excluded from the available weight; not zero. */
  "MISSING",
  /** NOT_APPLICABLE: the mandate declares nothing on this dimension; excluded. */
  "NOT_APPLICABLE",
] as const;
export const FactorOutcomeSchema = z.enum(FACTOR_OUTCOMES);

export const FactorResultSchema = z
  .object({
    featureId: FeatureIdSchema,
    featureVersion: FeatureVersionSchema,
    group: FeatureGroupSchema,
    featureStatus: FeatureValueStatusSchema,
    outcome: FactorOutcomeSchema,
    /** The feature's safe value: a category, a bounded number, or null. */
    featureValue: z.union([z.string(), z.number().finite()]).nullable(),
    missingReason: FeatureMissingReasonSchema.nullable(),
    /** In [0, 1] when SCORED; null otherwise. */
    normalizedValue: z.number().finite().min(0).max(1).nullable(),
    configuredWeight: z.number().finite().min(0),
    /** normalizedValue × configuredWeight ÷ availableWeight when SCORED; null otherwise. */
    contribution: z.number().finite().min(0).max(1).nullable(),
    polarity: FactorPolaritySchema.nullable(),
    reasonCode: RankingReasonCodeSchema,
    sourceClasses: z.array(FeatureSourceClassSchema).max(8),
  })
  .strict();
export type FactorResult = z.infer<typeof FactorResultSchema>;

export const RankingDiagnosticsSchema = z
  .object({
    configuredWeight: z.number().finite().min(0),
    /** Sum of the weights of SCORED factors: the score's denominator. */
    availableWeight: z.number().finite().min(0),
    /** availableWeight ÷ configuredWeight. Diagnostic only: never a penalty in v1. */
    factorCoverage: z.number().finite().min(0).max(1),
    presentFactorCount: z.number().int().min(0),
    missingFactorCount: z.number().int().min(0),
    notApplicableFactorCount: z.number().int().min(0),
  })
  .strict();
export type RankingDiagnostics = z.infer<typeof RankingDiagnosticsSchema>;

export const RankedCandidateSchema = z
  .object({
    companyId: z.string().uuid(),
    /** 1-based position in this ranking. */
    rank: z.number().int().min(1),
    /** In [0, 1], rounded to the config's precision; null when unscored. */
    internalScore: z.number().finite().min(0).max(1).nullable(),
    scored: z.boolean(),
    rankerId: z.literal(RANKER_ID),
    rankerVersion: z.literal(RANKER_VERSION),
    rankingConfigVersion: z.string().min(1).max(64),
    featureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
    /** The feature snapshot the score was computed from. */
    featureSnapshot: z
      .object({
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        mandateVersion: z.number().int().min(1),
        companyProjectionVersion: z.number().int().min(1),
      })
      .strict(),
    candidateProvenance: SnapshotCandidateProvenanceSchema,
    /** Scored factors in config order. */
    factors: z.array(FactorResultSchema).max(32),
    /** Distinct, in factor order; plus NO_SCOREABLE_FEATURES when unscored. */
    reasonCodes: z.array(RankingReasonCodeSchema).max(32),
    diagnostics: RankingDiagnosticsSchema,
  })
  .strict()
  .refine((c) => c.scored === (c.internalScore !== null), {
    message: "a scored candidate has a score; an unscored one has none",
  });
export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;

/** Why a ranking input was refused. Fail closed; nothing is partially ranked. */
export const RANKING_INPUT_ERRORS = [
  "CONTEXT_NOT_SUPPORTED",
  "CONTEXT_MISMATCH",
  "TENANT_MISMATCH",
  "INVESTOR_MISMATCH",
  "MANDATE_MISMATCH",
  "MANDATE_VERSION_MISMATCH",
  "COMPANY_MISMATCH",
  "DUPLICATE_COMPANY",
  "FEATURE_SCHEMA_MISMATCH",
  "ELIGIBILITY_POLICY_MISMATCH",
  "CANDIDATE_VERSION_MISMATCH",
  "SNAPSHOT_INVALID",
  "FEATURE_NOT_ALLOWED",
  "FEATURE_VERSION_MISMATCH",
  "NOT_ELIGIBLE",
  "FINGERPRINT_MISMATCH",
] as const;
export type RankingInputErrorCode = (typeof RANKING_INPUT_ERRORS)[number];

export class RankingInputError extends Error {
  readonly code: RankingInputErrorCode;
  readonly companyId: string | null;
  constructor(
    code: RankingInputErrorCode,
    companyId: string | null,
    detail: string,
  ) {
    // Codes, ids and versions only: never a feature value or mandate field.
    super(`${code}${companyId === null ? "" : ` (${companyId})`}: ${detail}`);
    this.name = "RankingInputError";
    this.code = code;
    this.companyId = companyId;
  }
}
