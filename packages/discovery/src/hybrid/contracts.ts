import { z } from "zod";

import {
  CandidateDiagnosticsSchema,
  CandidateProvenanceSchema,
  STRUCTURED_GENERATOR_VERSION,
} from "../candidates/contracts.js";
import { DISCOVERY_CANDIDATE_MAX } from "../contracts.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  EligibilityResultSchema,
  RecommendationContextSchema,
} from "../eligibility/contracts.js";
import {
  SEMANTIC_GENERATOR_VERSION,
  SemanticDiagnosticsSchema,
  SemanticProvenanceSchema,
} from "../semantic/contracts.js";

/**
 * The hybrid candidate pool (doc 19 §22, §37): structured candidates UNION
 * semantic candidates, deduplicated by canonical company id, every
 * provenance kept. One company, however many generators found it; not
 * two opportunities. Nothing here resolves a disagreement between
 * generators, ranks, scores or thresholds — the ranker (REC-005) reads
 * both provenances later.
 */

export const HYBRID_POOL_VERSION = "hybrid-candidate-pool.v1" as const;

export const HybridCandidateSchema = z
  .object({
    companyId: z.string().uuid(),
    /** Present when the structured generator found the company. */
    structured: CandidateProvenanceSchema.nullable(),
    /** Present when the semantic generator found the company. */
    semantic: SemanticProvenanceSchema.nullable(),
    /** REC-001's word, identical under either generator (same policy, same run). */
    eligibility: EligibilityResultSchema,
  })
  .strict()
  .refine((c) => c.structured !== null || c.semantic !== null, {
    message: "a hybrid candidate carries at least one provenance",
  });
export type HybridCandidate = z.infer<typeof HybridCandidateSchema>;

export const HybridDiagnosticsSchema = z
  .object({
    structured: CandidateDiagnosticsSchema,
    /** Null when the semantic generator was unavailable this run. */
    semantic: SemanticDiagnosticsSchema.nullable(),
    merged: z.number().int(),
    structuredOnly: z.number().int(),
    semanticOnly: z.number().int(),
    both: z.number().int(),
    durationMs: z.number().int(),
  })
  .strict();
export type HybridDiagnostics = z.infer<typeof HybridDiagnosticsSchema>;

export const HybridCandidatePoolSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("GENERATED"),
      poolVersion: z.literal(HYBRID_POOL_VERSION),
      structuredGeneratorVersion: z.literal(STRUCTURED_GENERATOR_VERSION),
      semanticGeneratorVersion: z.literal(SEMANTIC_GENERATOR_VERSION),
      eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
      context: RecommendationContextSchema,
      /**
       * The semantic generator degraded safely: the pool is the structured
       * pool alone, and says so. Never silently.
       */
      semanticUnavailable: z
        .object({
          failureClass: z.string().min(1).max(64),
          retryable: z.boolean(),
        })
        .strict()
        .nullable(),
      /** Canonical id order. A pool, not a slate. */
      candidates: z.array(HybridCandidateSchema).max(DISCOVERY_CANDIDATE_MAX),
      diagnostics: HybridDiagnosticsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("NO_ACTIVE_MANDATE"),
      poolVersion: z.literal(HYBRID_POOL_VERSION),
      context: RecommendationContextSchema,
    })
    .strict(),
]);
export type HybridCandidatePool = z.infer<typeof HybridCandidatePoolSchema>;
