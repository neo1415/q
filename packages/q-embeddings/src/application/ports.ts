import type {
  EmbedDocumentsRequest,
  EmbeddingBatchResult,
  EmbeddingProviderCode,
  EmbeddingProviderDescriptor,
  EmbeddingProviderHealth,
  EmbeddingResult,
  EmbedQueryRequest,
} from "../contracts/index.js";

/**
 * The embedding provider port (CQ-RAG-002 §6).
 *
 * An adapter is a thin translator over one embedding runtime: it maps a
 * provider-neutral request to that runtime's HTTP shape and the runtime's
 * answer and errors back to Capital Q's. It does not authorise, does not
 * decide what may be embedded, does not persist and does not retry.
 *
 * Capital Q depends on this interface, never on a runtime's client library,
 * a Python inference package or a model implementation. Replacing the
 * runtime is replacing one file.
 */

export type EmbeddingExecutionContext = {
  /** The caller's cancellation. The adapter adds its own timeout on top. */
  readonly signal?: AbortSignal | undefined;
  /** Overrides the adapter's configured timeout for this call. */
  readonly timeoutMs?: number | undefined;
  readonly correlationId?: string | undefined;
};

export type EmbeddingProvider = {
  readonly code: EmbeddingProviderCode;
  readonly describe: () => EmbeddingProviderDescriptor;
  /**
   * Embeds documents in caller order. Rejects with EmbeddingProviderFailure;
   * never with a runtime exception, never with a partially filled batch.
   */
  readonly embedDocuments: (
    request: EmbedDocumentsRequest,
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingBatchResult>;
  readonly embedQuery: (
    request: EmbedQueryRequest,
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingResult>;
  /** Never throws: an unreachable runtime is a reported state, not an error. */
  readonly health: (
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingProviderHealth>;
};
