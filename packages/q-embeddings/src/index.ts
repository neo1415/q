/**
 * @capital-q/q-embeddings — the embedding provider boundary (CQ-RAG-002).
 *
 * Owns: the provider-neutral EmbeddingProvider port, the versioned model and
 * configuration descriptors, the versioned query-instruction profiles,
 * vector validation, bounded batching, health, and the local Text
 * Embeddings Inference adapter.
 *
 * Does not own: chunks (Q Knowledge), vector storage or indexes
 * (CQ-RAG-003), retrieval or ranking (CQ-RAG-004), knowledge, claims or any
 * canonical truth. It authorises nothing and persists nothing.
 *
 * An embedding is a disposable derived index. The same chunk can be
 * re-embedded with another model, at another dimension, under another
 * instruction, without changing one word of what the source says.
 */

export * from "./contracts/index.js";
export {
  assertValidVector,
  cosineSimilarity,
  inputHash,
  UNIT_NORM_TOLERANCE,
  vectorNorm,
} from "./domain/vector.js";
export type {
  EmbeddingExecutionContext,
  EmbeddingProvider,
} from "./application/ports.js";
export {
  createEmbeddingService,
  type EmbeddingService,
  type EmbeddingServiceOptions,
} from "./application/service.js";
export {
  createLocalTeiEmbeddingProvider,
  LOCAL_TEI_PROVIDER_CODE,
  type LocalTeiProviderOptions,
} from "./infrastructure/local-tei-provider.js";
export {
  createFakeEmbeddingProvider,
  deterministicVector,
  FAKE_EMBEDDING_CONFIGURATION,
  FAKE_EMBEDDING_PROVIDER_CODE,
  type FakeEmbeddingBehaviour,
  type FakeEmbeddingProvider,
  type FakeEmbeddingProviderOptions,
} from "./providers/fake.js";

export const PACKAGE_NAME = "@capital-q/q-embeddings" as const;
