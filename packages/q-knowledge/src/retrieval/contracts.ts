import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  QKnowledgeScopeKindSchema,
  QRetrievalLayerSchema,
  QTaskClassSchema,
  UtcTimestampSchema,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type QKnowledgeScopeKind,
  type QRetrievalLayer,
  type QTaskClass,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { DocumentVersionId } from "@capital-q/evidence/contracts";

import {
  ChunkIdSchema,
  ChunkKindSchema,
  ChunkLocatorSchema,
  ChunkRoleSchema,
  ChunkSetIdSchema,
  type ChunkId,
  type ChunkKind,
  type ChunkLocator,
  type ChunkRole,
  type ChunkSetId,
} from "../contracts/index.js";

/**
 * Authorised hybrid retrieval (CQ-RAG-004; doc 14 §22-§27, doc 15 §19-§22,
 * doc 16 TM-RAG-01).
 *
 *   authorisation before similarity, always and only in that order
 *   retrieval hit ≠ evidence ≠ claim ≠ verified truth ≠ Q knowledge
 *   nearest neighbour ≠ authorised neighbour;  exact match ≠ permission
 *   reasoning access ≠ disclosure access ≠ download access
 *
 * The shapes here are what Q depends on. Nothing in them is a Postgres
 * type, a pgvector operator, a tsquery or a provider's request body, so the
 * database and the embedding runtime can both be replaced without Q
 * noticing, and neither can leak upward through a contract.
 */

// ---------------------------------------------------------------------------
// The permission envelope (§10-§11)
// ---------------------------------------------------------------------------

/**
 * One authorised way into the corpus, projected from exactly one scope of a
 * PermittedContextPlan.
 *
 * The envelope is a DISJUNCTION of these, and each one is a conjunction of
 * its own fields. That structure is the whole security property and it must
 * not be flattened: an actor permitted `founder_private` content about the
 * company they own AND `network_visible` content generally is not permitted
 * `founder_private` content about everyone. Unioning the labels and unioning
 * the subjects separately would grant exactly that.
 */
export type RetrievalScopeConstraint = {
  /** Which plan scope authorised this way in. Diagnostics and provenance. */
  readonly scopeKind: QKnowledgeScopeKind;
  readonly layer: QRetrievalLayer;
  /** Null means this scope is not narrowed by subject; never "all subjects are allowed". */
  readonly subjectIds: readonly string[] | null;
  /** At least one: a constraint that allows no disclosure scope allows nothing. */
  readonly visibilityScopes: readonly MarketplaceVisibility[];
  /** Chunks classified above this are not candidates under this scope. */
  readonly sensitivityCeiling: MessageSensitivity;
  /** Reasoning is granted by construction; the rest travels with the hit. */
  readonly canDiscloseExistence: boolean;
  readonly canQuote: boolean;
  readonly canProvideLink: boolean;
};

export const RetrievalScopeConstraintSchema = z
  .object({
    scopeKind: QKnowledgeScopeKindSchema,
    layer: QRetrievalLayerSchema,
    subjectIds: z.array(z.string().uuid()).min(1).max(64).nullable(),
    visibilityScopes: z.array(MarketplaceVisibilitySchema).min(1).max(8),
    sensitivityCeiling: MessageSensitivitySchema,
    canDiscloseExistence: z.boolean(),
    canQuote: z.boolean(),
    canProvideLink: z.boolean(),
  })
  .strict();

export const RETRIEVAL_CONSTRAINTS_MAX = 16;

/**
 * Everything retrieval is allowed to do for one run, and nothing else.
 *
 * It is produced deterministically from a PermittedContextPlan and can only
 * ever narrow it. Retrieval cannot widen it, a model cannot author it, and a
 * client cannot submit one: the fields a browser might try to send —
 * tenantId, visibility, sensitivity, subjects — are precisely the fields
 * that come from here.
 */
export type RetrievalPermissionEnvelope = {
  readonly planId: string;
  readonly planFingerprint: string;
  readonly policyVersion: string;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly organisationId: string | null;
  readonly taskClass: QTaskClass;
  readonly constraints: readonly RetrievalScopeConstraint[];
  /** The strongest class this run may reason over; a second, outer ceiling. */
  readonly maxSensitivity: MessageSensitivity;
  readonly evaluatedAt: UtcTimestamp;
  /** After this instant the plan is stale and must be re-decided, not reused. */
  readonly revalidateAfter: UtcTimestamp;
};

export const RetrievalPermissionEnvelopeSchema = z
  .object({
    planId: z.string().uuid(),
    planFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    policyVersion: z.string().min(1).max(64),
    tenantId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    organisationId: z.string().uuid().nullable(),
    taskClass: QTaskClassSchema,
    constraints: z
      .array(RetrievalScopeConstraintSchema)
      .max(RETRIEVAL_CONSTRAINTS_MAX),
    maxSensitivity: MessageSensitivitySchema,
    evaluatedAt: UtcTimestampSchema,
    revalidateAfter: UtcTimestampSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// The versioned retrieval configuration (§25-§26)
// ---------------------------------------------------------------------------

export const RETRIEVAL_STRATEGIES = [
  "HYBRID",
  "LEXICAL_ONLY",
  "SEMANTIC_ONLY",
] as const;
export type RetrievalStrategy = (typeof RETRIEVAL_STRATEGIES)[number];
export const RetrievalStrategySchema = z.enum(RETRIEVAL_STRATEGIES);

/**
 * Every tunable in one versioned place, so a retrieval result and the eval
 * that measured it are attributable to an exact configuration rather than to
 * "latest". Changing any field is a new version and a new baseline.
 */
export type RetrievalConfig = {
  readonly configVersion: string;
  /** Candidates the lexical half returns before fusion. */
  readonly lexicalCandidates: number;
  /** Candidates the semantic half returns before fusion. */
  readonly semanticCandidates: number;
  /** Candidates surviving fusion, before evidence expansion. */
  readonly fusedCandidates: number;
  /** Evidence hits handed to context assembly. */
  readonly finalHits: number;
  /**
   * RRF's smoothing constant, NOT a candidate count. It damps the influence
   * of the very top of either list so one confident lexical match cannot
   * outvote a broad semantic consensus. 60 is the value the published RRF
   * work uses and the value this baseline is measured at.
   */
  readonly rrfK: number;
  /** Ranks are 1-based in both input lists and in the fused output. */
  readonly rrfRankBase: 1;
  readonly embeddingConfigurationVersion: string;
  readonly embeddingDimension: number;
  readonly queryInstructionVersion: string;
  readonly distanceMetric: "COSINE";
  readonly ftsConfiguration: "english";
  readonly maxQueryCharacters: number;
  /** Ceiling on assembled evidence text, before the model is asked anything. */
  readonly maxContextCharacters: number;
  readonly maxCharactersPerHit: number;
  /** Whether a matched leaf may be replaced by its parent section. */
  readonly parentExpansion: boolean;
  readonly reranker: "NONE";
};

export const RETRIEVAL_CONFIG_VERSION = "capital-q-hybrid-v1" as const;

// ---------------------------------------------------------------------------
// Request and result (§9, §31)
// ---------------------------------------------------------------------------

export const RETRIEVAL_QUERY_MAX_CHARACTERS = 512;

export type AuthorisedRetrievalRequest = {
  /** The text to search for. DATA: it is never SQL, tsquery or instruction. */
  readonly query: string;
  readonly envelope: RetrievalPermissionEnvelope;
  readonly strategy?: RetrievalStrategy | undefined;
  /** Cooperative cancellation from the Q run. */
  readonly signal?: AbortSignal | undefined;
  /** Injected for determinism in tests; defaults to now. */
  readonly now?: Date | undefined;
};

export const AuthorisedRetrievalRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(RETRIEVAL_QUERY_MAX_CHARACTERS),
    envelope: RetrievalPermissionEnvelopeSchema,
    strategy: RetrievalStrategySchema.optional(),
  })
  .strict();

/** Why a half of the hybrid did not contribute. Internal; never public copy. */
export const RETRIEVAL_COMPONENT_STATES = [
  "OK",
  "NOT_ATTEMPTED",
  "UNAVAILABLE",
] as const;
export type RetrievalComponentState =
  (typeof RETRIEVAL_COMPONENT_STATES)[number];

export type RetrievalDegradation = {
  readonly lexical: RetrievalComponentState;
  readonly semantic: RetrievalComponentState;
  /**
   * A stable internal code when something degraded. Never a provider
   * message, never a database error, never a filename.
   */
  readonly reason:
    | "EMBEDDING_UNAVAILABLE"
    | "LEXICAL_UNAVAILABLE"
    | "SEMANTIC_UNAVAILABLE"
    | "STRATEGY_REQUESTED"
    | "NO_AUTHORISED_SCOPE"
    | null;
};

/**
 * One retrieved piece of source material.
 *
 * It is relevant text with provenance. It is not verified, not current
 * company truth, not a claim and not knowledge — CQ-KNW-001 begins that
 * interpretation. Ranks are retrieval provenance: they say why this
 * candidate is here, which is deterministic and inspectable, and they are
 * not confidence, quality or investment merit.
 */
export type RetrievalHit = {
  readonly chunkId: ChunkId;
  readonly chunkSetId: ChunkSetId;
  readonly documentId: string;
  readonly documentVersionId: DocumentVersionId;
  readonly documentTitle: string;
  readonly subjectType: "COMPANY";
  readonly subjectId: string;
  readonly chunkKind: ChunkKind;
  readonly role: ChunkRole;
  readonly locator: ChunkLocator;
  readonly content: string;
  readonly visibilityScope: MarketplaceVisibility;
  readonly sensitivityClass: MessageSensitivity;
  /** 1-based rank in the lexical list, or null when only the vector found it. */
  readonly lexicalRank: number | null;
  /** 1-based rank in the semantic list, or null when only FTS found it. */
  readonly semanticRank: number | null;
  readonly fusedRank: number;
  readonly fusedScore: number;
  /** Which envelope constraint admitted it. Retrieval provenance, not authority. */
  readonly scopeKind: QKnowledgeScopeKind;
  readonly canDiscloseExistence: boolean;
  readonly canQuote: boolean;
  readonly canProvideLink: boolean;
  readonly parentChunkId: ChunkId | null;
  /** Set when this hit is a parent substituted for the leaf that matched. */
  readonly expandedFromChunkId: ChunkId | null;
};

export type AuthorisedRetrievalResult = {
  readonly configVersion: string;
  readonly requestedStrategy: RetrievalStrategy;
  readonly executedStrategy: RetrievalStrategy;
  readonly degraded: RetrievalDegradation;
  readonly hits: readonly RetrievalHit[];
  /**
   * Counts, timings and codes for internal telemetry and evals. Safe by
   * construction: no query text, no chunk text, no title, no vector. A count
   * of what was excluded is deliberately absent — "3 results were withheld"
   * is itself a disclosure of existence (§14).
   */
  readonly diagnostics: {
    readonly lexicalCandidates: number;
    readonly semanticCandidates: number;
    readonly fusedCandidates: number;
    readonly constraintCount: number;
    readonly queryEmbeddingMs: number | null;
    readonly lexicalMs: number | null;
    readonly semanticMs: number | null;
    readonly fusionMs: number;
    readonly expansionMs: number;
    readonly totalMs: number;
    readonly contextCharacters: number;
  };
};

export const RetrievalHitSchema = z
  .object({
    chunkId: ChunkIdSchema,
    chunkSetId: ChunkSetIdSchema,
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    documentTitle: z.string(),
    subjectType: z.literal("COMPANY"),
    subjectId: z.string().uuid(),
    chunkKind: ChunkKindSchema,
    role: ChunkRoleSchema,
    locator: ChunkLocatorSchema,
    content: z.string(),
    visibilityScope: MarketplaceVisibilitySchema,
    sensitivityClass: MessageSensitivitySchema,
    lexicalRank: z.number().int().min(1).nullable(),
    semanticRank: z.number().int().min(1).nullable(),
    fusedRank: z.number().int().min(1),
    fusedScore: z.number(),
    scopeKind: QKnowledgeScopeKindSchema,
    canDiscloseExistence: z.boolean(),
    canQuote: z.boolean(),
    canProvideLink: z.boolean(),
    parentChunkId: ChunkIdSchema.nullable(),
    expandedFromChunkId: ChunkIdSchema.nullable(),
  })
  .strict();

/**
 * The V1 baseline. Conservative on purpose: 30 candidates per half is well
 * inside the 20-60 doc 14 §27 describes for a reranked pipeline, and 8 final
 * hits sits inside its 5-12, chosen without a reranker so precision comes
 * from the fusion rather than from a second model.
 */
export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  configVersion: RETRIEVAL_CONFIG_VERSION,
  lexicalCandidates: 30,
  semanticCandidates: 30,
  fusedCandidates: 20,
  finalHits: 8,
  rrfK: 60,
  rrfRankBase: 1,
  embeddingConfigurationVersion: "capital-q-qwen3-embedding-0-6b-1024-v1",
  embeddingDimension: 1024,
  queryInstructionVersion: "capital-q-evidence-retrieval-v1",
  distanceMetric: "COSINE",
  ftsConfiguration: "english",
  maxQueryCharacters: RETRIEVAL_QUERY_MAX_CHARACTERS,
  maxContextCharacters: 24_000,
  maxCharactersPerHit: 4_000,
  parentExpansion: true,
  reranker: "NONE",
};
