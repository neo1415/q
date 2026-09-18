import { z } from "zod";

import { CANDIDATE_DIMENSION_LIMIT } from "../candidates/contracts.js";
import { DISCOVERY_CANDIDATE_MAX } from "../contracts.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  EligibilityResultSchema,
  RecommendationContextSchema,
} from "../eligibility/contracts.js";

/**
 * Semantic candidate generation (doc 19 §24–§26, §117; doc 25 CQ-REC-003):
 * Candidate Generator B, the semantic mandate generator.
 *
 * The investor's ACTIVE mandate becomes a deterministic representation and
 * a query vector; discoverable companies have precomputed vectors over a
 * purpose-approved investment representation; pgvector returns a bounded
 * nearest-neighbour set; REC-001 decides which of them are rankable. It
 * supplements the structured generator where exact taxonomy misses nuance.
 * It replaces nothing.
 *
 * Kept apart, permanently:
 *
 *   Structured retrieval (REC-002) ≠ Semantic retrieval (this)
 *   Candidate generation (recall)  ≠ Ranking (REC-005)
 *   Similarity ≠ fit ≠ interest ≠ match ≠ quality ≠ probability
 *   Representation ≠ canonical truth;   embedding ≠ permission
 *   representation version ≠ embedding configuration ≠ generator version
 *
 * The one number here, cosine similarity, is retrieval provenance for a
 * later ranker. It is never shown as a percentage, a probability or a
 * verdict, and no threshold on it rejects anything.
 */

export const SEMANTIC_GENERATOR_ID = "SEMANTIC_MANDATE" as const;

/** Bumped when retrieval, the merge or the provenance shape changes. */
export const SEMANTIC_GENERATOR_VERSION = "semantic-mandate.v1" as const;

/** The only representation purpose in V1; a new purpose is a new value. */
export const REPRESENTATION_PURPOSE = "INVESTOR_DISCOVER" as const;

/**
 * Field selection and normalisation of the company text (doc 19 §25).
 * Changing either is a new version, and a new version is a rebuild.
 */
export const COMPANY_REPRESENTATION_VERSION =
  "company-investment-representation.v1" as const;

/** Likewise for the investor's mandate text (doc 19 §26). */
export const INVESTOR_REPRESENTATION_VERSION =
  "investor-mandate-representation.v1" as const;

/**
 * Cosine, because the configured runtime returns unit vectors and the
 * repository's other vector store (q_knowledge) already orders by cosine
 * distance: one metric per vector space. Similarity is `1 - distance`,
 * in [-1, 1]; for unit vectors it is the cosine of the angle.
 */
export const SEMANTIC_SIMILARITY_METRIC = "COSINE" as const;

/**
 * Nearest-neighbour budget. The same bound each structured dimension uses:
 * a pool is larger than a slate and smaller than a scan. Not a slate size
 * and not a threshold; ranking later decides what is worth showing.
 */
export const SEMANTIC_TOP_K = CANDIDATE_DIMENSION_LIMIT;

/** Representation refresh reads discoverable companies in bounded slices. */
export const REPRESENTATION_REFRESH_LIMIT = 500;

/**
 * Doc 19 §37: which generator found the company, under which versions,
 * and the generator-local similarity that ordered retrieval. Every
 * version that could change the number travels with it, so a later reader
 * never compares similarities from two spaces.
 */
export const SemanticProvenanceSchema = z
  .object({
    generatorId: z.literal(SEMANTIC_GENERATOR_ID),
    generatorVersion: z.literal(SEMANTIC_GENERATOR_VERSION),
    metric: z.literal(SEMANTIC_SIMILARITY_METRIC),
    /** Finite, bounded; deterministic for identical vectors. Internal. */
    similarity: z.number().finite().min(-1).max(1),
    companyRepresentationVersion: z.literal(COMPANY_REPRESENTATION_VERSION),
    investorRepresentationVersion: z.literal(INVESTOR_REPRESENTATION_VERSION),
    /** The embedding configuration both vectors were produced under. */
    configurationVersion: z.string().min(1).max(64),
    /** The document-side marker (no instruction) and the query instruction. */
    documentInstructionVersion: z.string().min(1).max(64),
    queryInstructionVersion: z.string().min(1).max(64),
  })
  .strict();
export type SemanticProvenance = z.infer<typeof SemanticProvenanceSchema>;

/** A rankable semantic candidate: retrieved AND ELIGIBLE under REC-001. */
export const SemanticCandidateSchema = z
  .object({
    companyId: z.string().uuid(),
    provenance: SemanticProvenanceSchema,
    eligibility: EligibilityResultSchema,
  })
  .strict();
export type SemanticCandidate = z.infer<typeof SemanticCandidateSchema>;

/** Safe counts and durations only. Never text, a vector or a marker. */
export const SemanticDiagnosticsSchema = z
  .object({
    topK: z.number().int(),
    /** Whether the query vector was computed this run or reused from the store. */
    queryVector: z.enum(["COMPUTED", "REUSED"]),
    /** Whether the mandate representation was rebuilt this run. */
    investorRepresentation: z.enum(["BUILT", "UNCHANGED"]),
    rawHits: z.number().int(),
    eligible: z.number().int(),
    ineligible: z.number().int(),
    undetermined: z.number().int(),
    queryDurationMs: z.number().int(),
    durationMs: z.number().int(),
  })
  .strict();
export type SemanticDiagnostics = z.infer<typeof SemanticDiagnosticsSchema>;

export const SemanticCandidateResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("GENERATED"),
      generatorId: z.literal(SEMANTIC_GENERATOR_ID),
      generatorVersion: z.literal(SEMANTIC_GENERATOR_VERSION),
      eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
      context: RecommendationContextSchema,
      /** ELIGIBLE only, in canonical id order. Similarity is in provenance, not in the order. */
      candidates: z.array(SemanticCandidateSchema).max(DISCOVERY_CANDIDATE_MAX),
      diagnostics: SemanticDiagnosticsSchema,
    })
    .strict(),
  /** No ACTIVE mandate (or an ambiguous one). Never a DRAFT fallback. */
  z
    .object({
      kind: z.literal("NO_ACTIVE_MANDATE"),
      generatorId: z.literal(SEMANTIC_GENERATOR_ID),
      generatorVersion: z.literal(SEMANTIC_GENERATOR_VERSION),
      context: RecommendationContextSchema,
    })
    .strict(),
  /**
   * The local embedding runtime could not answer. Typed, retryable or not,
   * and nothing else: no zero vector, no random vector, no other provider.
   * The structured generator is unaffected.
   */
  z
    .object({
      kind: z.literal("UNAVAILABLE"),
      generatorId: z.literal(SEMANTIC_GENERATOR_ID),
      generatorVersion: z.literal(SEMANTIC_GENERATOR_VERSION),
      context: RecommendationContextSchema,
      failureClass: z.string().min(1).max(64),
      retryable: z.boolean(),
    })
    .strict(),
]);
export type SemanticCandidateResult = z.infer<
  typeof SemanticCandidateResultSchema
>;

/** What a representation refresh did. Counts only. */
export const RepresentationRefreshReportSchema = z
  .object({
    representationVersion: z.literal(COMPANY_REPRESENTATION_VERSION),
    configurationVersion: z.string().min(1).max(64),
    /** Discoverable companies the refresh looked at. */
    considered: z.number().int(),
    /** Representations whose content changed (or did not exist) and were written. */
    built: z.number().int(),
    /** Representations whose content was identical to the current row. */
    unchanged: z.number().int(),
    /** Vectors computed by the embedding runtime this run. */
    embedded: z.number().int(),
    /** Vectors already present for the current content under this configuration. */
    reused: z.number().int(),
    durationMs: z.number().int(),
  })
  .strict();
export type RepresentationRefreshReport = z.infer<
  typeof RepresentationRefreshReportSchema
>;
