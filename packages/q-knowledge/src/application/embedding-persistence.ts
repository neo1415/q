import { getMeter, type Logger } from "@capital-q/observability";
import {
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  embeddingWorkKey,
  type EmbeddingService,
} from "@capital-q/q-embeddings";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { TenantIdSchema, type TenantId } from "@capital-q/security";

import {
  EmbeddingIdentitySchema,
  type EmbeddingIdentity,
  type StoredChunkEmbedding,
} from "../contracts/embeddings.js";
import { ChunkSetIdSchema, type Chunk } from "../contracts/index.js";
import type {
  ChunkEmbeddingRepository,
  SemanticSearchPort,
} from "./embedding-ports.js";
import type { QKnowledgeRepositories } from "./ports.js";

/**
 * Embedding persistence and backfill (CQ-RAG-003 §39-§42).
 *
 * Turns active chunks into durable vectors, once. Everything here is
 * bounded and idempotent because the work is background derived processing
 * that a queue will retry: a repeated run finds its row already written, a
 * concurrent duplicate loses a unique-constraint race, and neither produces
 * a second vector.
 *
 * It mutates no canonical truth. A chunk, a document, a source and a claim
 * all look exactly the same before and after an embedding exists.
 */

export type EmbeddingPersistenceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repositories: QKnowledgeRepositories & {
    readonly embeddings: ChunkEmbeddingRepository;
  };
  readonly embeddings: EmbeddingService;
  readonly semanticSearch?: SemanticSearchPort | undefined;
  readonly logger?: Logger | undefined;
};

export type PersistedEmbedding = {
  readonly chunkId: string;
  readonly embeddingId: string;
  /** False when the row already existed; the work was deduplicated. */
  readonly created: boolean;
  /** Content, model, dimension and instruction. Never a cache key across tenants. */
  readonly workKey: string;
};

export type EmbedChunksResult = {
  readonly configurationVersion: string;
  readonly embedded: readonly PersistedEmbedding[];
  readonly created: number;
  readonly deduplicated: number;
  readonly skippedInactive: number;
  readonly latencyMs: number;
};

/** The identity the configured provider is currently producing. */
export function documentEmbeddingIdentity(
  service: EmbeddingService,
): EmbeddingIdentity {
  const { configuration, providerCode } = service.describe();
  return EmbeddingIdentitySchema.parse({
    providerCode,
    modelCode: configuration.modelCode,
    modelRevision: configuration.modelRevision,
    configurationVersion: configuration.configurationVersion,
    // A stored embedding is a document embedding; a query instruction
    // belongs to a query, and queries are never stored.
    instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
    dimension: configuration.dimension,
  });
}

export function createEmbeddingPersistenceService(
  dependencies: EmbeddingPersistenceDependencies,
) {
  const { sql, transactions, repositories, embeddings, logger } = dependencies;
  const meter = getMeter("@capital-q/q-knowledge");
  const metrics = {
    persisted: meter.createCounter("q.embedding.persisted"),
    deduplicated: meter.createCounter("q.embedding.deduplicated"),
    skipped: meter.createCounter("q.embedding.skipped_inactive"),
    failures: meter.createCounter("q.embedding.persist_failures"),
    latencyMs: meter.createHistogram(
      "q.embedding.persist_latency_milliseconds",
    ),
  };

  /**
   * Embeds and stores a set of chunks the caller has already established are
   * active and theirs. Vectors go straight from the provider into the row;
   * they are never logged, returned or held longer than the write.
   */
  async function embedChunks(
    tenantId: TenantId,
    chunks: readonly Chunk[],
  ): Promise<EmbedChunksResult> {
    const started = Date.now();
    const identity = documentEmbeddingIdentity(embeddings);
    const labels = {
      configuration: identity.configurationVersion,
      model: identity.modelCode,
    };
    const eligible = chunks.filter((chunk) => chunk.status === "ACTIVE");
    const skippedInactive = chunks.length - eligible.length;
    if (skippedInactive > 0) {
      metrics.skipped.add(skippedInactive, labels);
    }
    if (eligible.length === 0) {
      return {
        configurationVersion: identity.configurationVersion,
        embedded: [],
        created: 0,
        deduplicated: 0,
        skippedInactive,
        latencyMs: Date.now() - started,
      };
    }

    // Work already done is not done again: the provider is the expensive
    // part, so the existing rows are checked before anything is embedded.
    const outstanding: Chunk[] = [];
    const alreadyStored: StoredChunkEmbedding[] = [];
    for (const chunk of eligible) {
      const existing = await repositories.embeddings.findByWorkIdentity(
        sql,
        tenantId,
        chunk.id,
        identity,
      );
      if (existing === null) outstanding.push(chunk);
      else alreadyStored.push(existing);
    }

    const persisted: PersistedEmbedding[] = [];
    let created = 0;
    let deduplicated = alreadyStored.length;
    for (const stored of alreadyStored) {
      persisted.push({
        chunkId: stored.chunkId,
        embeddingId: stored.id,
        created: false,
        workKey: embeddingWorkKey({
          contentSha256:
            eligible.find((c) => c.id === stored.chunkId)?.contentSha256 ?? "",
          modelCode: identity.modelCode,
          dimension: identity.dimension,
          instructionVersion: identity.instructionVersion,
        }),
      });
    }

    if (outstanding.length > 0) {
      let batch;
      try {
        batch = await embeddings.embedDocuments(
          outstanding.map((chunk) => chunk.content),
        );
      } catch (error: unknown) {
        metrics.failures.add(1, labels);
        throw error;
      }
      if (batch.embeddings.length !== outstanding.length) {
        metrics.failures.add(1, labels);
        throw new Error(
          "the embedding service returned a different number of vectors than chunks",
        );
      }
      for (const [at, chunk] of outstanding.entries()) {
        const result = batch.embeddings[at];
        if (result === undefined) {
          throw new Error("the embedding service returned a gap in a batch");
        }
        // The provider already validated dimension, finiteness and norm; the
        // store re-checks dimension because a wrong-sized vector must never
        // reach SQL, where it would surface as an opaque database error.
        if (result.dimension !== identity.dimension) {
          metrics.failures.add(1, labels);
          throw new Error(
            `the embedding has ${String(result.dimension)} dimensions where the configuration requires ${String(identity.dimension)}`,
          );
        }
        const write = await transactions.run((tx) =>
          repositories.embeddings.upsert(tx, {
            tenantId,
            chunkId: chunk.id,
            providerCode: identity.providerCode,
            modelCode: identity.modelCode,
            modelRevision: identity.modelRevision,
            configurationVersion: identity.configurationVersion,
            instructionVersion: identity.instructionVersion,
            dimension: identity.dimension,
            vector: result.vector,
          }),
        );
        if (write.created) created += 1;
        else deduplicated += 1;
        persisted.push({
          chunkId: chunk.id,
          embeddingId: write.embedding.id,
          created: write.created,
          workKey: embeddingWorkKey({
            contentSha256: chunk.contentSha256,
            modelCode: identity.modelCode,
            dimension: identity.dimension,
            instructionVersion: identity.instructionVersion,
          }),
        });
      }
    }

    metrics.persisted.add(created, labels);
    metrics.deduplicated.add(deduplicated, labels);
    const latencyMs = Date.now() - started;
    metrics.latencyMs.record(latencyMs, labels);
    // Counts, ids and versions. Never a vector, never chunk text.
    logger?.info(
      {
        ...labels,
        chunks: chunks.length,
        created,
        deduplicated,
        skippedInactive,
        latencyMs,
      },
      "chunk embeddings persisted",
    );
    return {
      configurationVersion: identity.configurationVersion,
      embedded: persisted,
      created,
      deduplicated,
      skippedInactive,
      latencyMs,
    };
  }

  return {
    identity: () => documentEmbeddingIdentity(embeddings),

    /** Embeds one chunk set, if it is still the tenant's and still active. */
    embedChunkSet: async (input: {
      readonly tenantId: string;
      readonly chunkSetId: string;
    }): Promise<EmbedChunksResult | { readonly outcome: "SKIPPED" }> => {
      const tenantId = TenantIdSchema.parse(input.tenantId);
      const chunkSetId = ChunkSetIdSchema.parse(input.chunkSetId);
      const set = await repositories.chunkSets.findById(
        sql,
        tenantId,
        chunkSetId,
      );
      if (set === null || set.status !== "ACTIVE") {
        return { outcome: "SKIPPED" };
      }
      const chunks = await repositories.chunks.listBySet(
        sql,
        tenantId,
        chunkSetId,
      );
      return embedChunks(tenantId, chunks);
    },

    /**
     * Embeds active chunks that have no vector under the current
     * configuration. Bounded by `limit` on purpose: a worker calls it again
     * rather than embedding a corpus inside one call, so a restart resumes
     * instead of starting over.
     */
    backfillMissing: async (
      input: {
        readonly tenantId?: string | undefined;
        readonly limit?: number | undefined;
      } = {},
    ): Promise<EmbedChunksResult & { readonly remaining: number }> => {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
      const identity = documentEmbeddingIdentity(embeddings);
      const tenantId =
        input.tenantId === undefined
          ? undefined
          : TenantIdSchema.parse(input.tenantId);
      const chunks = await repositories.embeddings.listChunksMissingEmbedding(
        sql,
        {
          tenantId,
          configurationVersion: identity.configurationVersion,
          limit,
        },
      );
      if (chunks.length === 0) {
        return {
          configurationVersion: identity.configurationVersion,
          embedded: [],
          created: 0,
          deduplicated: 0,
          skippedInactive: 0,
          latencyMs: 0,
          remaining: 0,
        };
      }
      // One tenant at a time: an embedding row's tenant must equal its
      // chunk's, and batching across tenants would invite mixing them up.
      const byTenant = new Map<TenantId, Chunk[]>();
      for (const chunk of chunks) {
        const bucket = byTenant.get(chunk.tenantId) ?? [];
        bucket.push(chunk);
        byTenant.set(chunk.tenantId, bucket);
      }
      const results: EmbedChunksResult[] = [];
      for (const [tenant, bucket] of byTenant) {
        results.push(await embedChunks(tenant, bucket));
      }
      const remaining = (
        await repositories.embeddings.listChunksMissingEmbedding(sql, {
          tenantId,
          configurationVersion: identity.configurationVersion,
          limit,
        })
      ).length;
      return {
        configurationVersion: identity.configurationVersion,
        embedded: results.flatMap((r) => r.embedded),
        created: results.reduce((n, r) => n + r.created, 0),
        deduplicated: results.reduce((n, r) => n + r.deduplicated, 0),
        skippedInactive: results.reduce((n, r) => n + r.skippedInactive, 0),
        latencyMs: results.reduce((n, r) => n + r.latencyMs, 0),
        remaining,
      };
    },

    embedChunks,
  };
}

export type EmbeddingPersistenceService = ReturnType<
  typeof createEmbeddingPersistenceService
>;
