import { z } from "zod";

import {
  createUuidIdSchema,
  TaxonomyAbstentionReasonSchema,
  TaxonomyCandidateConfidenceSchema,
  TaxonomyClassificationResolutionSchema,
  TaxonomyClassificationStrategySchema,
  TaxonomyVocabularyCodeSchema,
  type TaxonomyAbstentionReason,
  type TaxonomyCanonicalCode,
  type TaxonomyClassificationCandidateDto,
  type TaxonomyClassificationResolution,
  type TaxonomyClassificationStrategy,
  type TaxonomyClassifierIdentity,
  type TaxonomyMatchType,
  type TaxonomyVocabularyCode,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  TaxonomyNode,
  TaxonomyNodeId,
  TaxonomySubjectType,
  TaxonomyVersionSet,
} from "../../contracts/index.js";

/**
 * Classification contracts (CQ-TAX-002).
 *
 *   candidate ≠ canonical assignment ≠ verified fact
 *   confidence = deterministic indicator, NOT a calibrated probability
 *   classification run = provenance ("which classifier produced these?"),
 *   never audit ("who changed canonical state?")
 *
 * The classifier implemented here is deterministic: exact canonical-code,
 * alias and display-name matching plus bounded lexical search. Its
 * identity is recorded honestly on every run; it is not a model.
 */

export const TaxonomyClassificationRunIdSchema = createUuidIdSchema(
  "TaxonomyClassificationRunId",
);
export type TaxonomyClassificationRunId = z.infer<
  typeof TaxonomyClassificationRunIdSchema
>;

export const TAXONOMY_CLASSIFIER_PROVIDER = "capital_q" as const;
export const TAXONOMY_CLASSIFIER_MODEL = "deterministic_lexical" as const;
/** The versioned algorithm identifier recorded on every run and response. */
export const TAXONOMY_CLASSIFIER_VERSION = "taxonomy-lexical-v1" as const;

export const TAXONOMY_CLASSIFIER_IDENTITY: TaxonomyClassifierIdentity = {
  provider: TAXONOMY_CLASSIFIER_PROVIDER,
  model: TAXONOMY_CLASSIFIER_MODEL,
  version: TAXONOMY_CLASSIFIER_VERSION,
};

/** Strategies this packet actually executes. SEMANTIC / MODEL are refused. */
export const TAXONOMY_SUPPORTED_STRATEGIES = [
  "AUTO",
  "EXACT",
  "LEXICAL",
] as const;
export type TaxonomySupportedStrategy =
  (typeof TAXONOMY_SUPPORTED_STRATEGIES)[number];

/**
 * Deliberately small lifecycle that also fits future asynchronous
 * classifiers. FAILED = execution failure; "no candidate" is ABSTAINED.
 */
export const TAXONOMY_CLASSIFICATION_RUN_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "ABSTAINED",
  "FAILED",
] as const;
export const TaxonomyClassificationRunStatusSchema = z.enum(
  TAXONOMY_CLASSIFICATION_RUN_STATUSES,
);
export type TaxonomyClassificationRunStatus = z.infer<
  typeof TaxonomyClassificationRunStatusSchema
>;

/**
 * Canonical input sources a persistent run may reference today. Only
 * sources whose owning resource exists: COMPANY_PROFILE = the canonical
 * company row itself. Onboarding responses and evidence sources arrive with
 * their packets; the column is free text so they need no migration.
 */
export const TAXONOMY_INPUT_SOURCE_TYPES = ["COMPANY_PROFILE"] as const;
export const TaxonomyInputSourceTypeSchema = z.enum(
  TAXONOMY_INPUT_SOURCE_TYPES,
);
export type TaxonomyInputSourceType = z.infer<
  typeof TaxonomyInputSourceTypeSchema
>;

export const TAXONOMY_RATIONALE_MAX_LENGTH = 300;

/**
 * Bounded, safe run metadata. Never raw text, prompts, document chunks or
 * provider responses; the input hash supports reproducibility and dedup
 * diagnostics without being the source.
 */
export const TaxonomyClassificationRunMetadataSchema = z
  .object({
    strategy: TaxonomyClassificationStrategySchema.optional(),
    resolution: TaxonomyClassificationResolutionSchema.optional(),
    candidateCount: z.number().int().min(0).optional(),
    vocabularyCodes: z.array(TaxonomyVocabularyCodeSchema).max(16).optional(),
    abstentionReason: TaxonomyAbstentionReasonSchema.optional(),
    inputHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    inputLength: z.number().int().min(0).optional(),
    failureCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(64)
      .optional(),
  })
  .strict();
export type TaxonomyClassificationRunMetadata = z.infer<
  typeof TaxonomyClassificationRunMetadataSchema
>;

// ---------------------------------------------------------------------------
// In-memory classification results
// ---------------------------------------------------------------------------

/** One generator hit: a node, how it was found, and a raw score in [0, 1]. */
export type TaxonomyCandidate = {
  readonly node: TaxonomyNode;
  readonly matchType: TaxonomyMatchType;
  /** Generator-local score in [0, 1]; exact generators emit 1. */
  readonly score: number;
  /** The platform text (code, label or alias) that matched. Never user input. */
  readonly matchedText: string;
  /** Deterministic detail for the rationale (e.g. "2/2 tokens"). */
  readonly detail?: string | undefined;
};

export type TaxonomyClassificationCandidate =
  TaxonomyClassificationCandidateDto;

export type TaxonomyClassificationResult = {
  readonly resolution: TaxonomyClassificationResolution;
  readonly candidates: readonly TaxonomyClassificationCandidate[];
  readonly abstentionReason?: TaxonomyAbstentionReason | undefined;
  readonly taxonomyVersions: TaxonomyVersionSet;
  readonly classifier: TaxonomyClassifierIdentity;
};

// ---------------------------------------------------------------------------
// Persistent provenance
// ---------------------------------------------------------------------------

export type TaxonomyClassificationRun = {
  readonly id: TaxonomyClassificationRunId;
  readonly tenantId: TenantId;
  readonly subjectType: TaxonomySubjectType;
  readonly subjectId: string;
  readonly inputSourceType: string | null;
  readonly inputSourceId: string | null;
  readonly classifierProvider: string;
  readonly classifierModel: string;
  readonly classifierVersion: string;
  /** Snapshot of the vocabulary versions the run used. */
  readonly taxonomyVersion: TaxonomyVersionSet;
  readonly status: TaxonomyClassificationRunStatus;
  readonly startedAt: UtcTimestamp;
  readonly completedAt: UtcTimestamp | null;
  /** Exact decimal string. Deterministic runs cost "0". */
  readonly costUsd: string;
  readonly metadata: TaxonomyClassificationRunMetadata;
};

/** A persisted candidate. `accepted` is tri-state: null = unresolved. */
export type TaxonomyClassificationCandidateRecord = {
  readonly runId: TaxonomyClassificationRunId;
  readonly nodeId: TaxonomyNodeId;
  readonly vocabularyCode: TaxonomyVocabularyCode;
  readonly canonicalCode: TaxonomyCanonicalCode;
  readonly rank: number;
  readonly confidence: string;
  readonly matchTypes: readonly TaxonomyMatchType[];
  readonly rationaleSummary: string;
  readonly accepted: boolean | null;
  readonly decidedByUserId: UserId | null;
  readonly decidedAt: UtcTimestamp | null;
};

export {
  TaxonomyCandidateConfidenceSchema,
  type TaxonomyClassificationStrategy,
};
