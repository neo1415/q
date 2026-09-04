import type { TaxonomyMatchType } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  TaxonomyNode,
  TaxonomyNodeId,
  TaxonomySubjectType,
  TaxonomyVersionSet,
  TaxonomyVocabularyCode,
} from "../../contracts/index.js";
import type {
  TaxonomyCandidate,
  TaxonomyClassificationCandidateRecord,
  TaxonomyClassificationRun,
  TaxonomyClassificationRunId,
  TaxonomyClassificationRunMetadata,
  TaxonomyClassificationRunStatus,
} from "../contracts/index.js";

/**
 * Ports of the classification pipeline. Generators are the extension
 * seam: exact and lexical generators exist today; semantic and model
 * generators are declared as narrow interfaces and deliberately have no
 * adapter here. None of these types imports a provider SDK.
 */

export type TaxonomyCandidateGenerationRequest = {
  /** The caller's text, untouched. Generators must not persist or log it. */
  readonly rawText: string;
  readonly normalizedText: string;
  readonly tokens: readonly string[];
  /** Active vocabularies in scope; never empty. */
  readonly vocabularyCodes: readonly TaxonomyVocabularyCode[];
  readonly limit: number;
};

export type TaxonomyCandidateGenerator = {
  readonly id: string;
  readonly version: string;
  readonly generate: (
    executor: DatabaseExecutor,
    request: TaxonomyCandidateGenerationRequest,
  ) => Promise<readonly TaxonomyCandidate[]>;
};

/** One retrieved lexical row: a node plus the platform text it was found through. */
export type LexicalSearchHit = {
  readonly node: TaxonomyNode;
  readonly field: "canonical_code" | "display_name" | "alias";
  /** The normalised platform text (label, code words or alias). */
  readonly text: string;
  /** pg_trgm word_similarity(text, query) in [0, 1]. */
  readonly wordSimilarity: number;
};

export type LexicalSearchQuery = {
  readonly normalizedText: string;
  readonly tokens: readonly string[];
  readonly vocabularyCodes: readonly TaxonomyVocabularyCode[];
  readonly similarityFloor: number;
  /** Similarity retrieval applies only to candidate texts at least this long. */
  readonly similarityMinCandidateLength: number;
  readonly rowLimit: number;
};

/**
 * Bounded lexical retrieval over canonical codes, display names and
 * aliases of ACTIVE nodes in ACTIVE vocabularies. Parameterised only; the
 * client never supplies a pattern, tsquery or regex.
 */
export type TaxonomyLexicalSearchRepository = {
  readonly search: (
    executor: DatabaseExecutor,
    query: LexicalSearchQuery,
  ) => Promise<readonly LexicalSearchHit[]>;
  /** Exact normalised display-name equality within the scoped vocabularies. */
  readonly findByNormalizedDisplayName: (
    executor: DatabaseExecutor,
    normalizedDisplayName: string,
    vocabularyCodes: readonly TaxonomyVocabularyCode[],
  ) => Promise<readonly TaxonomyNode[]>;
};

// ---------------------------------------------------------------------------
// Future extension seams (interfaces only; no implementation in CQ-TAX-002)
// ---------------------------------------------------------------------------

/**
 * Semantic candidate retrieval (embedding/vector based) arrives later. It
 * must still return canonical TaxonomyNodeIds; vector storage never
 * becomes taxonomy truth. Not implemented here; nothing registers one.
 */
export type SemanticTaxonomyCandidateProvider = TaxonomyCandidateGenerator & {
  readonly kind: "SEMANTIC";
};

/**
 * Bounded model classification arrives in Wave 5 through the Q Model
 * Gateway and routing policy. Its output is candidates, never assignments.
 * Not implemented here; nothing registers one.
 */
export type ModelTaxonomyClassifier = TaxonomyCandidateGenerator & {
  readonly kind: "MODEL";
  readonly provenance: {
    readonly provider: string;
    readonly model: string;
  };
};

// ---------------------------------------------------------------------------
// Persistent provenance
// ---------------------------------------------------------------------------

export type NewTaxonomyClassificationRun = {
  readonly tenantId: TenantId;
  readonly subjectType: TaxonomySubjectType;
  readonly subjectId: string;
  readonly inputSourceType: string | null;
  readonly inputSourceId: string | null;
  readonly classifierProvider: string;
  readonly classifierModel: string;
  readonly classifierVersion: string;
  readonly taxonomyVersion: TaxonomyVersionSet;
  readonly metadata: TaxonomyClassificationRunMetadata;
};

export type NewTaxonomyClassificationCandidate = {
  readonly nodeId: TaxonomyNodeId;
  readonly rank: number;
  readonly confidence: string;
  readonly matchTypes: readonly TaxonomyMatchType[];
  readonly rationaleSummary: string;
};

/**
 * Runs are provenance, never audit, and never deleted through this port.
 * Reads are tenant-scoped at the SQL level in addition to application
 * authorisation.
 */
export type TaxonomyClassificationRunRepository = {
  readonly insertRun: (
    tx: TransactionContext,
    input: NewTaxonomyClassificationRun,
  ) => Promise<TaxonomyClassificationRun>;
  readonly finishRun: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly runId: TaxonomyClassificationRunId;
      readonly status: Exclude<TaxonomyClassificationRunStatus, "RUNNING">;
      readonly costUsd: string;
      readonly metadata: TaxonomyClassificationRunMetadata;
    },
  ) => Promise<void>;
  readonly findRun: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: TaxonomyClassificationRunId,
  ) => Promise<TaxonomyClassificationRun | null>;
  readonly insertCandidates: (
    tx: TransactionContext,
    runId: TaxonomyClassificationRunId,
    candidates: readonly NewTaxonomyClassificationCandidate[],
  ) => Promise<void>;
  readonly listCandidates: (
    executor: DatabaseExecutor,
    runId: TaxonomyClassificationRunId,
  ) => Promise<readonly TaxonomyClassificationCandidateRecord[]>;
  readonly findCandidate: (
    executor: DatabaseExecutor,
    runId: TaxonomyClassificationRunId,
    nodeId: TaxonomyNodeId,
  ) => Promise<TaxonomyClassificationCandidateRecord | null>;
  /** Records a decision on an undecided candidate; returns false if already decided. */
  readonly decideCandidate: (
    tx: TransactionContext,
    input: {
      readonly runId: TaxonomyClassificationRunId;
      readonly nodeId: TaxonomyNodeId;
      readonly accepted: boolean;
      readonly decidedByUserId: UserId;
      readonly decidedAt: string;
    },
  ) => Promise<boolean>;
};
