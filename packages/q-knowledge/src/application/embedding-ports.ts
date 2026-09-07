import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId } from "@capital-q/security";

import type {
  ChunkEmbeddingId,
  EmbeddingIdentity,
  NewChunkEmbedding,
  SemanticCandidate,
  SemanticSearchScope,
  StoredChunkEmbedding,
} from "../contracts/embeddings.js";
import type { Chunk, ChunkId } from "../contracts/index.js";

/**
 * Persistence and candidate-generation ports for the semantic index
 * (CQ-RAG-003 §31, §36).
 *
 * Every vector operation lives behind these types. No SQL, no pgvector
 * operator and no table name is reachable from an API route, a Q graph node,
 * the web app or any domain package: a caller states a typed scope, and the
 * infrastructure decides how to satisfy it.
 */

export type ChunkEmbeddingRepository = {
  /**
   * Writes one embedding, or returns the one already there. Idempotent on
   * the work identity, so a retried worker and a concurrent duplicate both
   * end with a single row.
   */
  readonly upsert: (
    tx: TransactionContext,
    input: NewChunkEmbedding,
  ) => Promise<{
    readonly embedding: StoredChunkEmbedding;
    /** False when the row already existed and nothing was written. */
    readonly created: boolean;
  }>;
  readonly findByWorkIdentity: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    chunkId: ChunkId,
    identity: EmbeddingIdentity,
  ) => Promise<StoredChunkEmbedding | null>;
  readonly listByChunk: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    chunkId: ChunkId,
  ) => Promise<readonly StoredChunkEmbedding[]>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    id: ChunkEmbeddingId,
  ) => Promise<StoredChunkEmbedding | null>;
  /**
   * Active chunks with no embedding under this configuration, oldest first.
   * The unit of backfill work; always bounded by `limit`.
   */
  readonly listChunksMissingEmbedding: (
    executor: DatabaseExecutor,
    query: {
      readonly tenantId?: TenantId | undefined;
      readonly configurationVersion: string;
      readonly limit: number;
    },
  ) => Promise<readonly Chunk[]>;
  readonly countByConfiguration: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    configurationVersion: string,
  ) => Promise<number>;
};

/**
 * Bounded nearest-neighbour candidate generation over one tenant's active
 * chunks in one vector space.
 *
 * It is candidate generation, not retrieval and not authorisation. Being the
 * nearest vector is not permission to be read: the scope constrains the
 * search before any distance is computed, and CQ-RAG-004 puts the Context
 * Firewall's authorised envelope in front of it.
 */
export type SemanticSearchPort = {
  readonly search: (
    executor: DatabaseExecutor,
    scope: SemanticSearchScope,
  ) => Promise<readonly SemanticCandidate[]>;
};
