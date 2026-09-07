import { getMeter, type Logger } from "@capital-q/observability";

import {
  EmbeddingProviderFailure,
  type EmbeddingBatchResult,
  type EmbeddingProviderDescriptor,
  type EmbeddingProviderHealth,
  type EmbeddingQueryTask,
  type EmbeddingResult,
} from "../contracts/index.js";
import type { EmbeddingExecutionContext, EmbeddingProvider } from "./ports.js";

/**
 * The embedding service (CQ-RAG-002 §29, §35, §42).
 *
 * One seam between Capital Q and whatever runtime is configured: it splits
 * work into bounded batches, keeps results in caller order, counts what
 * happened and reports failures in Capital Q's classes. It persists
 * nothing — CQ-RAG-003 owns storage — and it authorises nothing: the
 * content it receives was already chosen by trusted application logic.
 *
 * What it measures is counts, durations and failure classes. What it never
 * touches is the text or the vectors: both are derived sensitive data, and
 * a metric or a log line is exactly the place they must not appear.
 */

export type EmbeddingServiceOptions = {
  readonly provider: EmbeddingProvider;
  readonly logger?: Logger | undefined;
};

export type EmbeddingService = {
  readonly describe: () => EmbeddingProviderDescriptor;
  /**
   * Embeds many inputs, in caller order, in bounded batches. One failing
   * batch fails the call: a half-embedded corpus reported as success is how
   * silent gaps enter an index.
   */
  readonly embedDocuments: (
    inputs: readonly string[],
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingBatchResult>;
  readonly embedQuery: (
    query: string,
    task: EmbeddingQueryTask,
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingResult>;
  readonly health: (
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingProviderHealth>;
};

export function createEmbeddingService(
  options: EmbeddingServiceOptions,
): EmbeddingService {
  const { provider, logger } = options;
  const meter = getMeter("@capital-q/q-embeddings");
  const metrics = {
    requests: meter.createCounter("q.embedding.requests"),
    inputs: meter.createCounter("q.embedding.inputs"),
    failures: meter.createCounter("q.embedding.failures"),
    latencyMs: meter.createHistogram("q.embedding.latency_milliseconds"),
    batchSize: meter.createHistogram("q.embedding.batch_size"),
    inputCharacters: meter.createHistogram("q.embedding.input_characters"),
  };
  const descriptor = provider.describe();
  // Dimensions are small fixed sets: never a tenant, a document or a query.
  const labels = {
    provider: descriptor.providerCode,
    model: descriptor.configuration.modelCode,
    configuration: descriptor.configuration.configurationVersion,
  };

  const record = (kind: "document" | "query", started: number): void => {
    metrics.requests.add(1, { ...labels, kind });
    metrics.latencyMs.record(Date.now() - started, { ...labels, kind });
  };

  const recordFailure = (kind: string, error: unknown): void => {
    const failureClass =
      error instanceof EmbeddingProviderFailure
        ? error.failureClass
        : "UNKNOWN";
    metrics.failures.add(1, { ...labels, kind, failure: failureClass });
    // The class and the counts, never the input and never the runtime's own
    // words: a provider message can quote the text it was given.
    logger?.warn(
      { ...labels, kind, failure: failureClass },
      "embedding request failed",
    );
  };

  return {
    describe: () => descriptor,

    embedDocuments: async (inputs, context = {}) => {
      const started = Date.now();
      if (inputs.length === 0) {
        return { embeddings: [], batchSize: 0, latencyMs: 0 };
      }
      const size = descriptor.configuration.maxBatchItems;
      const embeddings: EmbeddingResult[] = [];
      try {
        for (let at = 0; at < inputs.length; at += size) {
          const batch = inputs.slice(at, at + size);
          metrics.batchSize.record(batch.length, labels);
          for (const input of batch) {
            metrics.inputCharacters.record(input.length, labels);
          }
          const result = await provider.embedDocuments(
            { inputs: batch },
            context,
          );
          if (result.embeddings.length !== batch.length) {
            throw new EmbeddingProviderFailure(
              "the embedding provider returned a different number of vectors than inputs",
              {
                failureClass: "INVALID_RESPONSE",
                providerCode: descriptor.providerCode,
              },
            );
          }
          embeddings.push(...result.embeddings);
        }
      } catch (error: unknown) {
        recordFailure("document", error);
        throw error;
      }
      metrics.inputs.add(embeddings.length, { ...labels, kind: "document" });
      record("document", started);
      return {
        embeddings,
        batchSize: embeddings.length,
        latencyMs: Date.now() - started,
      };
    },

    embedQuery: async (query, task, context = {}) => {
      const started = Date.now();
      try {
        const result = await provider.embedQuery({ query, task }, context);
        metrics.inputs.add(1, { ...labels, kind: "query" });
        record("query", started);
        return result;
      } catch (error: unknown) {
        recordFailure("query", error);
        throw error;
      }
    },

    health: (context = {}) => provider.health(context),
  };
}
