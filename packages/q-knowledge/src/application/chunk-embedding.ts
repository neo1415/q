import {
  embeddingWorkKey,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  type EmbeddingResult,
  type EmbeddingService,
} from "@capital-q/q-embeddings";
import { TenantIdSchema } from "@capital-q/security";

import { ChunkSetIdSchema, type Chunk } from "../contracts/index.js";
import type { QKnowledgeRepositories } from "./ports.js";

/**
 * The chunk embedding seam (CQ-RAG-002 §33, §35).
 *
 * Turns eligible chunks into validated embedding results and stops there:
 * CQ-RAG-003 owns the vector rows, the pgvector column and the index. What
 * this seam adds over calling the provider directly is the eligibility
 * check — a chunk that has been superseded or revoked is not embedded,
 * because spending on a vector nobody may retrieve is the cheapest kind of
 * stale private data.
 *
 * It is not a security boundary. The chunks it reads were already scoped by
 * tenant; the embedding provider decides nothing about who may see them.
 */

export type ChunkEmbedding = {
  readonly chunkId: string;
  readonly tenantId: string;
  readonly chunkSetId: string;
  readonly contentSha256: string;
  /**
   * The deterministic identity of this work: content, model, dimension and
   * instruction. Not a cache key and not an ownership key — storage scopes
   * rows by tenant, so two tenants with identical text keep separate rows.
   */
  readonly workKey: string;
  readonly embedding: EmbeddingResult;
};

export type EmbedChunkSetInput = {
  readonly tenantId: string;
  readonly chunkSetId: string;
  readonly signal?: AbortSignal | undefined;
};

export type EmbedChunkSetResult =
  | {
      readonly outcome: "EMBEDDED";
      readonly embeddings: readonly ChunkEmbedding[];
      readonly latencyMs: number;
    }
  | {
      readonly outcome: "SKIPPED";
      readonly reason: "NO_CHUNKS" | "NOT_ACTIVE";
    };

export type ChunkEmbeddingProcessorDependencies = {
  readonly repositories: QKnowledgeRepositories;
  readonly sql: Parameters<QKnowledgeRepositories["chunks"]["listBySet"]>[0];
  readonly embeddings: EmbeddingService;
};

export function createChunkEmbeddingProcessor(
  dependencies: ChunkEmbeddingProcessorDependencies,
) {
  const { repositories, embeddings, sql } = dependencies;

  return async (input: EmbedChunkSetInput): Promise<EmbedChunkSetResult> => {
    const tenantId = TenantIdSchema.parse(input.tenantId);
    const chunkSetId = ChunkSetIdSchema.parse(input.chunkSetId);
    const set = await repositories.chunkSets.findById(
      sql,
      tenantId,
      chunkSetId,
    );
    if (set === null || set.status !== "ACTIVE") {
      // Superseded or revoked: eligibility is checked before work is done,
      // not after a vector exists.
      return { outcome: "SKIPPED", reason: "NOT_ACTIVE" };
    }
    const chunks: readonly Chunk[] = (
      await repositories.chunks.listBySet(sql, tenantId, chunkSetId)
    ).filter((chunk) => chunk.status === "ACTIVE");
    if (chunks.length === 0) {
      return { outcome: "SKIPPED", reason: "NO_CHUNKS" };
    }

    const started = Date.now();
    const batch = await embeddings.embedDocuments(
      chunks.map((chunk) => chunk.content),
      input.signal === undefined ? {} : { signal: input.signal },
    );
    if (batch.embeddings.length !== chunks.length) {
      throw new Error(
        "the embedding service returned a different number of vectors than chunks",
      );
    }
    const descriptor = embeddings.describe();
    return {
      outcome: "EMBEDDED",
      embeddings: chunks.map((chunk, at) => {
        const embedding = batch.embeddings[at];
        if (embedding === undefined) {
          throw new Error("the embedding service returned a gap in a batch");
        }
        return {
          chunkId: chunk.id,
          tenantId: chunk.tenantId,
          chunkSetId: chunk.chunkSetId,
          contentSha256: chunk.contentSha256,
          workKey: embeddingWorkKey({
            contentSha256: chunk.contentSha256,
            modelCode: descriptor.configuration.modelCode,
            dimension: descriptor.configuration.dimension,
            instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
          }),
          embedding,
        };
      }),
      latencyMs: Date.now() - started,
    };
  };
}
