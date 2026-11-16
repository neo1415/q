import {
  MESSAGE_SENSITIVITIES,
  sensitivityAtMost,
  type MessageSensitivity,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  EmbeddingProviderFailure,
  type EmbeddingService,
} from "@capital-q/q-embeddings";

import type { Chunk, ChunkId } from "../contracts/index.js";
import { documentEmbeddingIdentity } from "./embedding-persistence.js";
import type { ChunkEmbeddingRepository } from "./embedding-ports.js";

/**
 * The production chunk-embedding sweep (owner decision 99, 2026-11-16).
 *
 * Embeds ACTIVE chunks that have no vector under the configured embedding
 * configuration, a bounded number per run, so a worker calls it on an
 * interval and a restart simply resumes.
 *
 * Privacy before cost: a chunk is sent to the provider only when its own
 * sensitivity class AND its document's current class are at or below the
 * provider's ceiling, which the caller reads from the Model Gateway's
 * reviewed provider record (never a constant here). The repository filters
 * in SQL; the class is checked again here before any text leaves, so a
 * repository bug cannot widen what a vendor receives. Withheld chunks stay
 * lexical-only, by design, and are counted in the run's log line.
 *
 * Idempotent and retry-safe: the work identity is a unique constraint and
 * the insert is ON CONFLICT DO NOTHING, so a rerun or a concurrent worker
 * writes nothing twice. No transaction is open during a provider call: the
 * provider answers first, then each vector is written in its own short
 * transaction.
 *
 * Over-long chunks: the provider's `maxInputCharacters` bounds the input.
 * A longer chunk is embedded from a deterministic prefix of exactly that
 * many characters (never splitting a surrogate pair). Chunk identity and
 * text are untouched: the chunk keeps its one row and its full content for
 * lexical search and for the passage Q reads; only the vector is computed
 * from the prefix. Whether a vector came from a prefix is derivable
 * (char_length(content) > the configuration's limit) and is logged per run
 * with the chunk ids, so no migration is needed to record it.
 */

export type ChunkEmbeddingSweepDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repository: ChunkEmbeddingRepository;
  readonly embeddings: EmbeddingService;
  /**
   * The strongest class the provider may be sent; null means nothing.
   * Undefined only for a self-hosted runtime on the private network, where
   * no text leaves Capital Q.
   */
  readonly ceiling?: (() => Promise<MessageSensitivity | null>) | undefined;
  readonly logger?: Pick<Logger, "info" | "warn" | "error"> | undefined;
};

export type ChunkEmbeddingSweepReport = {
  readonly configurationVersion: string;
  readonly outcome: "COMPLETED" | "STOPPED_ON_FAILURE" | "PROVIDER_INELIGIBLE";
  readonly ceiling: MessageSensitivity | "NONE" | "UNBOUNDED";
  readonly listed: number;
  readonly created: number;
  readonly deduplicated: number;
  readonly truncated: number;
  readonly truncatedChunkIds: readonly string[];
  /** Listed but refused by the second check. Expected to be zero. */
  readonly skippedBySensitivity: number;
  /** Vectorless ACTIVE chunks the ceiling withholds (lexical-only). */
  readonly withheldBySensitivity: number;
  readonly failures: Readonly<Record<string, number>>;
};

/** A prefix of at most `limit` UTF-16 units that never ends mid-pair. */
export function embeddingInputFor(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const last = content.charCodeAt(limit - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return content.slice(0, cut);
}

function failureCode(error: unknown): string {
  return error instanceof EmbeddingProviderFailure
    ? error.failureClass
    : "UNKNOWN";
}

export async function sweepChunkEmbeddings(
  dependencies: ChunkEmbeddingSweepDependencies,
  options: { readonly maxChunks: number },
): Promise<ChunkEmbeddingSweepReport> {
  const { sql, transactions, repository, embeddings, logger } = dependencies;
  const identity = documentEmbeddingIdentity(embeddings);
  const configuration = embeddings.describe().configuration;
  const maxChunks = Math.min(Math.max(options.maxChunks, 1), 5_000);

  const ceiling =
    dependencies.ceiling === undefined
      ? undefined
      : await dependencies.ceiling();
  const failures: Record<string, number> = {};
  const fail = (code: string, n = 1): void => {
    failures[code] = (failures[code] ?? 0) + n;
  };
  const base: Pick<
    ChunkEmbeddingSweepReport,
    "configurationVersion" | "ceiling"
  > = {
    configurationVersion: identity.configurationVersion,
    ceiling: ceiling === undefined ? "UNBOUNDED" : (ceiling ?? "NONE"),
  };

  if (ceiling === null) {
    // The provider is not in the catalogue, not ACTIVE, or its model row is
    // disabled: nothing is sent, and the reason is a log line, not silence.
    const report: ChunkEmbeddingSweepReport = {
      ...base,
      outcome: "PROVIDER_INELIGIBLE",
      listed: 0,
      created: 0,
      deduplicated: 0,
      truncated: 0,
      truncatedChunkIds: [],
      skippedBySensitivity: 0,
      withheldBySensitivity: 0,
      failures,
    };
    logger?.warn(
      { ...report, provider: identity.providerCode },
      "chunk embedding sweep: provider has no eligible ceiling; nothing sent",
    );
    return report;
  }

  const allowed: readonly MessageSensitivity[] | undefined =
    ceiling === undefined
      ? undefined
      : MESSAGE_SENSITIVITIES.filter((s) => sensitivityAtMost(s, ceiling));
  const withheldBySensitivity =
    allowed === undefined
      ? 0
      : await repository.countChunksWithheldBySensitivity(sql, {
          configurationVersion: identity.configurationVersion,
          allowedSensitivities: allowed,
        });

  const attempted: ChunkId[] = [];
  const truncatedChunkIds: string[] = [];
  let listed = 0;
  let created = 0;
  let deduplicated = 0;
  let skippedBySensitivity = 0;
  let outcome: ChunkEmbeddingSweepReport["outcome"] = "COMPLETED";

  /** Embeds one batch and writes it; throws only on a provider failure. */
  async function embedAndWrite(batch: readonly Chunk[]): Promise<void> {
    const inputs = batch.map((chunk) =>
      embeddingInputFor(chunk.content, configuration.maxInputCharacters),
    );
    // The provider call: no transaction is open here.
    const result = await embeddings.embedDocuments(inputs);
    if (result.embeddings.length !== batch.length) {
      throw new EmbeddingProviderFailure(
        "the embedding service returned a different number of vectors than chunks",
        {
          failureClass: "INVALID_RESPONSE",
          providerCode: embeddings.describe().providerCode,
        },
      );
    }
    for (const [at, chunk] of batch.entries()) {
      const embedding = result.embeddings[at];
      if (embedding?.dimension !== identity.dimension) {
        fail("INVALID_RESPONSE");
        continue;
      }
      if (inputs[at] !== chunk.content) truncatedChunkIds.push(chunk.id);
      // One short transaction per vector, after the provider answered. The
      // row's tenant is the chunk's own (the composite FK enforces it).
      const write = await transactions.run((tx) =>
        repository.upsert(tx, {
          tenantId: chunk.tenantId,
          chunkId: chunk.id,
          providerCode: identity.providerCode,
          modelCode: identity.modelCode,
          modelRevision: identity.modelRevision,
          configurationVersion: identity.configurationVersion,
          instructionVersion: identity.instructionVersion,
          dimension: identity.dimension,
          vector: embedding.vector,
        }),
      );
      if (write.created) created += 1;
      else deduplicated += 1;
    }
  }

  /** Bounded by the provider's item and character limits. */
  function batchesOf(chunks: readonly Chunk[]): Chunk[][] {
    const batches: Chunk[][] = [];
    let current: Chunk[] = [];
    let characters = 0;
    for (const chunk of chunks) {
      const size = Math.min(
        chunk.content.length,
        configuration.maxInputCharacters,
      );
      if (
        current.length > 0 &&
        (current.length >= configuration.maxBatchItems ||
          characters + size > configuration.maxBatchCharacters)
      ) {
        batches.push(current);
        current = [];
        characters = 0;
      }
      current.push(chunk);
      characters += size;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  sweep: while (listed < maxChunks) {
    const page = await repository.listChunksMissingEmbedding(sql, {
      configurationVersion: identity.configurationVersion,
      limit: Math.min(configuration.maxBatchItems * 4, maxChunks - listed),
      allowedSensitivities: allowed,
      excludeChunkIds: attempted,
    });
    if (page.length === 0) break;
    listed += page.length;
    attempted.push(...page.map((chunk) => chunk.id));

    // The second check, on the rows themselves, before any text leaves.
    const eligible = page.filter(
      (chunk) =>
        chunk.status === "ACTIVE" &&
        (allowed === undefined || allowed.includes(chunk.sensitivityClass)),
    );
    skippedBySensitivity += page.length - eligible.length;

    // One tenant per provider request, as the backfill does: a batch never
    // mixes two tenants' text.
    const byTenant = new Map<string, Chunk[]>();
    for (const chunk of eligible) {
      const bucket = byTenant.get(chunk.tenantId) ?? [];
      bucket.push(chunk);
      byTenant.set(chunk.tenantId, bucket);
    }
    for (const bucket of byTenant.values()) {
      for (const batch of batchesOf(bucket)) {
        try {
          await embedAndWrite(batch);
        } catch (error: unknown) {
          const code = failureCode(error);
          if (code === "INPUT_TOO_LARGE" && batch.length > 1) {
            // One input the provider refuses must not hold back the rest:
            // retry one at a time and record only the ones that fail.
            for (const chunk of batch) {
              try {
                await embedAndWrite([chunk]);
              } catch (single: unknown) {
                fail(failureCode(single));
              }
            }
            continue;
          }
          fail(code, batch.length);
          if (code !== "INPUT_TOO_LARGE") {
            // The provider is down, refusing the key or timing out: stop,
            // and let the next interval try again rather than hammer it.
            outcome = "STOPPED_ON_FAILURE";
            break sweep;
          }
        }
      }
    }
  }

  const report: ChunkEmbeddingSweepReport = {
    ...base,
    outcome,
    listed,
    created,
    deduplicated,
    truncated: truncatedChunkIds.length,
    truncatedChunkIds,
    skippedBySensitivity,
    withheldBySensitivity,
    failures,
  };
  // Counts, ids, codes and versions. Never chunk text, never a vector.
  const level =
    outcome === "STOPPED_ON_FAILURE" || Object.keys(failures).length > 0
      ? "error"
      : "info";
  logger?.[level](
    {
      ...report,
      provider: identity.providerCode,
      ...(level === "error" ? { alert: "CHUNK_EMBEDDING_FAILED" } : {}),
      withheldReason: "SENSITIVITY_ABOVE_PROVIDER_CEILING",
    },
    "chunk embedding sweep",
  );
  return report;
}
