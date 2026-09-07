import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type {
  DocumentId,
  DocumentVersionId,
  EvidenceSourceId,
} from "@capital-q/evidence/contracts";
import type { TenantId } from "@capital-q/security";

import type {
  Chunk,
  ChunkSet,
  ChunkSetId,
  ChunkSetStatus,
  ChunkSetStatusReason,
  NewChunk,
  NewChunkSet,
} from "../contracts/index.js";

/**
 * Persistence ports for the derived chunk store. Every call takes the tenant
 * explicitly; nothing is scoped by ambient state. Rows change lifecycle
 * only; content and provenance are written once.
 */

export type ChunkSetRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewChunkSet,
  ) => Promise<ChunkSet>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    chunkSetId: ChunkSetId,
  ) => Promise<ChunkSet | null>;
  /** The one logical set for (version, extraction, chunker). */
  readonly findByIdentity: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentVersionId: DocumentVersionId,
    extractionId: string,
    chunkingVersion: string,
  ) => Promise<ChunkSet | null>;
  readonly listByDocument: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentId: DocumentId,
  ) => Promise<readonly ChunkSet[]>;
  readonly listByVersion: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentVersionId: DocumentVersionId,
  ) => Promise<readonly ChunkSet[]>;
  readonly listBySource: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    sourceId: EvidenceSourceId,
  ) => Promise<readonly ChunkSet[]>;
  /**
   * Moves sets, and every chunk in them, to a non-active status. ACTIVE →
   * SUPERSEDED | REVOKED, SUPERSEDED → REVOKED; nothing returns to ACTIVE
   * and nothing leaves REVOKED. Returns how many sets changed.
   */
  readonly transition: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly chunkSetIds: readonly ChunkSetId[];
      readonly status: Exclude<ChunkSetStatus, "ACTIVE">;
      readonly reason: ChunkSetStatusReason;
    },
  ) => Promise<number>;
};

export type ChunkRepository = {
  readonly insert: (tx: TransactionContext, input: NewChunk) => Promise<Chunk>;
  readonly listBySet: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    chunkSetId: ChunkSetId,
  ) => Promise<readonly Chunk[]>;
  readonly listActiveByVersion: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentVersionId: DocumentVersionId,
  ) => Promise<readonly Chunk[]>;
};

export type QKnowledgeRepositories = {
  readonly chunkSets: ChunkSetRepository;
  readonly chunks: ChunkRepository;
};
