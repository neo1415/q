import { z } from "zod";

import {
  createUuidIdSchema,
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type {
  DocumentVersionId,
  EvidenceSubjectType,
} from "@capital-q/evidence/contracts";
import type { TenantId } from "@capital-q/security";

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
} from "./index.js";

/**
 * Embedding storage contracts (CQ-RAG-003; doc 13 §41.2, doc 14 §15, §115).
 *
 *   chunk ≠ embedding ≠ evidence ≠ claim ≠ knowledge ≠ canonical fact
 *   similarity ≠ relevance truth;  nearest neighbour ≠ authorised neighbour
 *
 * A stored embedding is an index entry over one chunk under one embedding
 * configuration. It is disposable: rebuildable from the chunk at any time,
 * replaceable by another model, and never consulted for whether someone may
 * see something.
 */

export const ChunkEmbeddingIdSchema = createUuidIdSchema("ChunkEmbeddingId");
export type ChunkEmbeddingId = z.infer<typeof ChunkEmbeddingIdSchema>;

/**
 * Which embedding run produced a vector, recorded on the row so a historical
 * embedding stays attributable after the code's constants move on.
 */
export const EmbeddingIdentitySchema = z
  .object({
    providerCode: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    modelCode: z.string().min(1).max(128),
    modelRevision: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
    configurationVersion: z.string().regex(/^[a-z][a-z0-9-]*-v[0-9]+$/),
    instructionVersion: z.string().regex(/^[a-z][a-z0-9-]*-v[0-9]+$/),
    dimension: z.number().int().min(1).max(4096),
  })
  .strict();
export type EmbeddingIdentity = z.infer<typeof EmbeddingIdentitySchema>;

/**
 * The row as the application reads it back. The vector is deliberately
 * absent: nothing outside the distance query needs it, and a vector that
 * never leaves the database cannot be logged, serialised or returned by
 * accident.
 */
export type StoredChunkEmbedding = {
  readonly id: ChunkEmbeddingId;
  readonly tenantId: TenantId;
  readonly chunkId: ChunkId;
  readonly providerCode: string;
  readonly modelCode: string;
  readonly modelRevision: string | null;
  readonly configurationVersion: string;
  readonly instructionVersion: string;
  readonly dimension: number;
  readonly createdAt: UtcTimestamp;
};

export type NewChunkEmbedding = Omit<
  StoredChunkEmbedding,
  "id" | "createdAt"
> & {
  /** Validated before it reaches SQL; bound as a parameter, never interpolated. */
  readonly vector: readonly number[];
};

// ---------------------------------------------------------------------------
// Internal semantic search (§24, §31-§33, §63-§64)
// ---------------------------------------------------------------------------

/**
 * The ceiling on one internal candidate query. Bounded because an unbounded
 * K over a vector store is a full scan with a sort, and because candidate
 * generation feeds a retrieval envelope that stays small on purpose.
 */
export const SEMANTIC_SEARCH_MAX_K = 100;
export const SEMANTIC_SEARCH_DEFAULT_K = 10;

/**
 * What an internal semantic query must state. There is deliberately no raw
 * SQL, no operator, no table name, no tenant override and no "include
 * private" escape: every field is typed, and the scope is required rather
 * than defaulted, so a caller cannot forget to say who is asking.
 */
/**
 * One authorised way into the corpus, as the vector query sees it
 * (CQ-RAG-004 §10). A conjunction of subject, disclosure scope and
 * sensitivity ceiling; several of these form a DISJUNCTION, and they are
 * never flattened into separate unions — that would pair every label with
 * every subject and grant what neither alone allows.
 */
export const AuthorisedChunkConstraintSchema = z
  .object({
    subjectIds: z.array(z.string().uuid()).min(1).max(64).nullable(),
    visibilityScopes: z.array(MarketplaceVisibilitySchema).min(1).max(8),
    sensitivityCeiling: MessageSensitivitySchema,
  })
  .strict();
export type AuthorisedChunkConstraint = z.infer<
  typeof AuthorisedChunkConstraintSchema
>;

export const SemanticSearchScopeSchema = z
  .object({
    tenantId: z.string().uuid(),
    /** Which vector space to search. Two configurations are never mixed. */
    configurationVersion: z.string().regex(/^[a-z][a-z0-9-]*-v[0-9]+$/),
    /**
     * The dimension this vector space uses. Stated by the caller so a query
     * vector of the wrong shape is refused here, before SQL, rather than
     * surfacing as an opaque database error or — worse — as an empty result
     * that looks like "nothing matched".
     */
    dimension: z.number().int().min(1).max(4096),
    /** Finite numbers only; NaN and Infinity are not a position in a space. */
    queryVector: z.array(z.number().finite()).min(1),
    k: z.number().int().min(1).max(SEMANTIC_SEARCH_MAX_K),
    /** When present, only chunks about these subjects are candidates. */
    subjectIds: z.array(z.string().uuid()).max(200).optional(),
    /**
     * When present, only chunks at these disclosure scopes are candidates.
     * Absent means the caller has not narrowed by scope — it never means
     * "any scope is permitted"; the authorised envelope is CQ-RAG-004's job.
     */
    allowedVisibilityScopes: z
      .array(MarketplaceVisibilitySchema)
      .min(1)
      .max(8)
      .optional(),
    /**
     * The authorised envelope, as a disjunction (CQ-RAG-004). Present for
     * every retrieval the Context Firewall drives. Absent leaves the query
     * exactly as CQ-RAG-003 shipped it — narrowed by the flat axes above and
     * by nothing else — which is why no production path may omit it: the
     * authorised retrieval service is the only caller that builds this scope
     * for a person, and it always sets this field.
     */
    authorisedScopes: z
      .array(AuthorisedChunkConstraintSchema)
      .min(1)
      .max(16)
      .optional(),
    /**
     * Restricts candidates to chunks derived from the CURRENT version of a
     * document whose set and document are both still active. Superseded
     * versions and archived documents are what "revoked evidence must not
     * come back" means in practice (§45-§47).
     */
    requireCurrentSource: z.boolean().optional(),
  })
  .strict()
  .refine((scope) => scope.queryVector.length === scope.dimension, {
    message:
      "the query vector's length must equal the vector space's dimension",
    path: ["queryVector"],
  });
export type SemanticSearchScope = z.infer<typeof SemanticSearchScopeSchema>;

/**
 * One candidate. `distance` is cosine distance: lower is nearer. `similarity`
 * is `1 - distance` for readability. Neither is a score, a confidence, a
 * quality, a fit or a ranking of investment merit; they measure how close two
 * pieces of text sit in one model's vector space and nothing else.
 */
export type SemanticCandidate = {
  readonly chunkId: ChunkId;
  readonly chunkSetId: ChunkSetId;
  readonly documentVersionId: DocumentVersionId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly chunkKind: ChunkKind;
  readonly role: ChunkRole;
  readonly locator: ChunkLocator;
  readonly visibilityScope: MarketplaceVisibility;
  readonly sensitivityClass: MessageSensitivity;
  /** The chunk's text, for the retrieval composition CQ-RAG-004 will do. */
  readonly content: string;
  /** Cosine distance in [0, 2]; lower is nearer. */
  readonly distance: number;
  /** `1 - distance`; higher is nearer. Never a confidence or a quality. */
  readonly similarity: number;
  /** 1-based position in this result, by ascending distance. */
  readonly rank: number;
  readonly configurationVersion: string;
  readonly modelCode: string;
};

export const SemanticCandidateSchema = z
  .object({
    chunkId: ChunkIdSchema,
    chunkSetId: ChunkSetIdSchema,
    documentVersionId: z.string().uuid(),
    subjectType: z.literal("COMPANY"),
    subjectId: z.string().uuid(),
    chunkKind: ChunkKindSchema,
    role: ChunkRoleSchema,
    locator: ChunkLocatorSchema,
    visibilityScope: MarketplaceVisibilitySchema,
    sensitivityClass: MessageSensitivitySchema,
    content: z.string(),
    distance: z.number(),
    similarity: z.number(),
    rank: z.number().int().min(1),
    configurationVersion: z.string(),
    modelCode: z.string(),
  })
  .strict();
