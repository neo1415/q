import { z } from "zod";

import { DISCOVERY_CANDIDATE_MAX } from "../contracts.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  EligibilityResultSchema,
  RecommendationContextSchema,
} from "../eligibility/contracts.js";

/**
 * Structured candidate generation (doc 19 §22–§23, §36–§37; doc 25
 * CQ-REC-002): Candidate Generator A, the structured mandate generator.
 *
 * Candidate generation seeks HIGH RECALL; ranking later improves
 * precision. So the generator is a UNION of independent dimension
 * retrievals — stage, geography, taxonomy, cheque — merged by canonical
 * company id, never one AND-filter that a single unknown field would
 * empty. A company surfaced by one dimension keeps every other dimension's
 * reason it also earns. Match count is not a rank.
 *
 * Kept apart, permanently:
 *
 *   Candidate generation (recall) ≠ Ranking (precision)
 *   Structured retrieval ≠ Semantic retrieval (REC-003)
 *   Candidate provenance ≠ Recommendation explanation (REC-007)
 *   "found by a dimension" ≠ "eligible" (REC-001 decides)
 *   structured unknown ≠ hard-eligibility unknown
 *
 * No score, no rank, no probability, no prose, no model, no randomness.
 */

/** Doc 19 §23 names this generator; the id is what provenance carries. */
export const STRUCTURED_GENERATOR_ID = "STRUCTURED_MANDATE" as const;

/**
 * Bumped whenever a dimension's retrieval rule, a reason code, the merge
 * or the ordering changes. Distinct from eligibility.v1 and
 * marketplace-readiness.v1: a different policy boundary.
 */
export const STRUCTURED_GENERATOR_VERSION = "structured-mandate.v1" as const;

export const CANDIDATE_DIMENSIONS = [
  "STAGE",
  "GEOGRAPHY",
  "TAXONOMY",
  "CHEQUE",
] as const;
export const CandidateDimensionSchema = z.enum(CANDIDATE_DIMENSIONS);
export type CandidateDimension = z.infer<typeof CandidateDimensionSchema>;

/**
 * Why the structured generator surfaced a company. Each names the
 * canonical field or declared preference that overlapped; none names a
 * source, a document, a memory or a page.
 */
export const CANDIDATE_REASON_CODES = [
  /** current_stage_code ∈ the mandate's positive stage intent. */
  "STAGE_OVERLAP",
  /** headquarters_country ∈ a positive `geography.country` constraint. */
  "GEOGRAPHY_OVERLAP",
  /** An ACTIVE geography-vocabulary classification equals, or descends from, a positive geography preference node. */
  "GEOGRAPHY_REGION_OVERLAP",
  /** An ACTIVE classification equals a positive taxonomy preference node. */
  "TAXONOMY_OVERLAP",
  /** An ACTIVE classification descends from a positive taxonomy preference node (reference hierarchy). */
  "TAXONOMY_DESCENDANT_OVERLAP",
  /** Reserved: no canonical, discovery-safe raise projection exists in V1, so this is never produced. */
  "CHEQUE_OVERLAP",
] as const;
export const CandidateReasonCodeSchema = z.enum(CANDIDATE_REASON_CODES);
export type CandidateReasonCode = z.infer<typeof CandidateReasonCodeSchema>;

/** One taxonomy overlap: which declared node, which canonical node the company carries. Ids only. */
export const MatchedNodeSchema = z
  .object({
    preferredNodeId: z.string().uuid(),
    matchedNodeId: z.string().uuid(),
    vocabularyCode: z.string().min(1).max(64),
    exact: z.boolean(),
  })
  .strict();
export type MatchedNode = z.infer<typeof MatchedNodeSchema>;

/**
 * Doc 19 §37: which generator found the company, which version, why.
 * There is no generatorScore: exact structured matches earn reason codes,
 * not numbers, and this generator has no natural relevance value.
 */
export const CandidateProvenanceSchema = z
  .object({
    generatorId: z.literal(STRUCTURED_GENERATOR_ID),
    generatorVersion: z.literal(STRUCTURED_GENERATOR_VERSION),
    /** Sorted, distinct. */
    matchedDimensions: z.array(CandidateDimensionSchema).min(1).max(4),
    /** Sorted, distinct. */
    reasonCodes: z.array(CandidateReasonCodeSchema).min(1).max(8),
    /** Sorted by (preferredNodeId, matchedNodeId); bounded. */
    matchedNodes: z.array(MatchedNodeSchema).max(64),
    taxonomyVersion: z.record(z.string(), z.number().int()).nullable(),
  })
  .strict();
export type CandidateProvenance = z.infer<typeof CandidateProvenanceSchema>;

/** A rankable candidate: found by the generator AND ELIGIBLE under REC-001. */
export const StructuredCandidateSchema = z
  .object({
    companyId: z.string().uuid(),
    provenance: CandidateProvenanceSchema,
    eligibility: EligibilityResultSchema,
  })
  .strict();
export type StructuredCandidate = z.infer<typeof StructuredCandidateSchema>;

/** Safe counts only. Never a company, a mandate value or a marker. */
export const CandidateDiagnosticsSchema = z
  .object({
    rawHitsByDimension: z.record(CandidateDimensionSchema, z.number().int()),
    rawHits: z.number().int(),
    deduped: z.number().int(),
    /** True when the merged pool exceeded CANDIDATE_POOL_MAX and was cut on canonical id order. */
    truncated: z.boolean(),
    eligible: z.number().int(),
    ineligible: z.number().int(),
    undetermined: z.number().int(),
    /** The cheque seam's word for this run; v1 always reports it as not computable. */
    chequeSignal: z.enum(["COMPUTED", "NOT_COMPUTABLE"]),
    durationMs: z.number().int(),
  })
  .strict();
export type CandidateDiagnostics = z.infer<typeof CandidateDiagnosticsSchema>;

export const StructuredCandidateResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("GENERATED"),
      generatorId: z.literal(STRUCTURED_GENERATOR_ID),
      generatorVersion: z.literal(STRUCTURED_GENERATOR_VERSION),
      eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
      context: RecommendationContextSchema,
      /** ELIGIBLE only, in canonical id order. Not a slate, not a rank. */
      candidates: z
        .array(StructuredCandidateSchema)
        .max(DISCOVERY_CANDIDATE_MAX),
      diagnostics: CandidateDiagnosticsSchema,
    })
    .strict(),
  /** No ACTIVE mandate (or an ambiguous one): nothing to retrieve against. Never a DRAFT fallback. */
  z
    .object({
      kind: z.literal("NO_ACTIVE_MANDATE"),
      generatorId: z.literal(STRUCTURED_GENERATOR_ID),
      generatorVersion: z.literal(STRUCTURED_GENERATOR_VERSION),
      context: RecommendationContextSchema,
    })
    .strict(),
]);
export type StructuredCandidateResult = z.infer<
  typeof StructuredCandidateResultSchema
>;

/**
 * Budgets. Each dimension retrieval is bounded and ordered by canonical id;
 * the merged pool is capped at the existing discovery candidate budget.
 * A pool is larger than a slate and smaller than a scan.
 */
export const CANDIDATE_DIMENSION_LIMIT = 200;
export const CANDIDATE_POOL_MAX = DISCOVERY_CANDIDATE_MAX;
