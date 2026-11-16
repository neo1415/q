import type { ModelSensitivity } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createEmbeddingCeilingReader,
  type ModelCatalogPort,
} from "@capital-q/model-gateway";
import type { EmbeddingService } from "@capital-q/q-embeddings";
import {
  createPostgresChunkEmbeddingRepository,
  sweepChunkEmbeddings,
  type ChunkEmbeddingRepository,
  type ChunkEmbeddingSweepReport,
} from "@capital-q/q-knowledge";

import { abortableSleep, type RunnerLogger } from "./outbox-runner.js";

/**
 * Document-chunk embeddings in production (owner decision 99, 2026-11-16).
 *
 * Until now nothing in a deployed service wrote q_knowledge.embeddings: the
 * persistence seam was only called from dev scripts, so Q's evidence
 * retrieval was lexical-only. This loop runs the bounded sweep at start and
 * on an interval with the worker's configured embedder (the same one that
 * embeds Discover companies, so one configuration version), sending only
 * chunks at or below the provider's reviewed ceiling.
 *
 * Volume is naturally bounded: a sweep embeds only ACTIVE chunks with no
 * vector under this configuration, at most `maxChunks` per run, so after
 * the first backfill a run costs only what new documents add.
 */

export const CHUNK_EMBEDDING_SWEEP_MAX_CHUNKS = 1_000;
export const CHUNK_EMBEDDING_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export type ChunkEmbeddingSweepRuntime = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly embeddings: EmbeddingService;
  /** Undefined only for a self-hosted runtime (no text leaves Capital Q). */
  readonly ceiling: (() => Promise<ModelSensitivity | null>) | undefined;
  readonly repository?: ChunkEmbeddingRepository | undefined;
  readonly logger: RunnerLogger;
};

/**
 * The ceiling for the worker's embedder: the gateway's reviewed provider
 * record for a hosted API; none for the self-hosted runtime.
 */
export function chunkEmbeddingCeiling(
  embeddings: EmbeddingService,
  catalog: ModelCatalogPort,
): (() => Promise<ModelSensitivity | null>) | undefined {
  const { providerCode, configuration } = embeddings.describe();
  return configuration.runtime === "HOSTED_API"
    ? createEmbeddingCeilingReader({
        catalog,
        providerCode,
        modelCode: configuration.modelCode,
      })
    : undefined;
}

/** One sweep; never throws (a failure is an error line with an alert). */
export async function runChunkEmbeddingSweepOnce(
  runtime: ChunkEmbeddingSweepRuntime,
  maxChunks: number = CHUNK_EMBEDDING_SWEEP_MAX_CHUNKS,
): Promise<ChunkEmbeddingSweepReport | null> {
  try {
    return await sweepChunkEmbeddings(
      {
        sql: runtime.sql,
        transactions: runtime.transactions,
        repository:
          runtime.repository ?? createPostgresChunkEmbeddingRepository(),
        embeddings: runtime.embeddings,
        ceiling: runtime.ceiling,
        logger: runtime.logger,
      },
      { maxChunks },
    );
  } catch (error: unknown) {
    // A database or catalogue fault. Never the chunk text.
    runtime.logger.error(
      {
        alert: "CHUNK_EMBEDDING_FAILED",
        error: error instanceof Error ? error.name : "UNKNOWN",
      },
      "chunk embedding sweep failed",
    );
    return null;
  }
}

/** At start, then every `intervalMs` until shutdown. */
export async function runChunkEmbeddingSweepLoop(options: {
  readonly runtime: ChunkEmbeddingSweepRuntime;
  readonly intervalMs: number;
  readonly maxChunks: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  for (;;) {
    if (options.signal.aborted) return;
    await runChunkEmbeddingSweepOnce(options.runtime, options.maxChunks);
    await abortableSleep(options.intervalMs, options.signal);
  }
}
