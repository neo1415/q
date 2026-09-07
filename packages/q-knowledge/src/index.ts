/**
 * @capital-q/q-knowledge — the Q knowledge bounded context (CQ-RAG-001).
 *
 * Owns: structure-aware, versioned, provenance-preserving chunks derived
 * from governed document extractions; their lifecycle; rebuild and
 * revocation.
 *
 * Owns since CQ-RAG-003: versioned pgvector storage over those chunks.
 * Owns since CQ-RAG-004: authorised hybrid retrieval — Postgres full-text
 * search and pgvector candidate generation, both constrained by the Context
 * Firewall's plan before ranking, fused by Reciprocal Rank Fusion, and
 * assembled into bounded, source-labelled evidence for Q.
 *
 * Does not own (yet or ever): permission decisions (the Context Firewall
 * decides; this obeys), claims and evidence intelligence (CQ-KNW-001),
 * knowledge objects (CQ-KNW-002), documents or extraction (Evidence),
 * recommendation ranking, the Data Room. It calls no model to rank or
 * rewrite, exposes no search API, fetches no URL, and executes nothing a
 * document says.
 */

export * from "./contracts/index.js";
export * from "./contracts/embeddings.js";
export {
  CHARACTERS_PER_TOKEN,
  contentHash,
  estimateTokens,
  packSentences,
  planChunks,
  selectStrategy,
  splitSentences,
} from "./chunking/index.js";
export {
  assertInherits,
  DerivedGovernanceError,
  isNoWiderThan,
  visibilityRank,
} from "./domain/inheritance.js";
export type {
  ChunkRepository,
  ChunkSetRepository,
  QKnowledgeRepositories,
} from "./application/ports.js";
export {
  BuildChunkSetInputSchema,
  createBuildChunkSet,
  createListActiveChunks,
  createListChunks,
  createListChunkSets,
  createRebuildChunkSet,
  createRevokeChunkSets,
  RebuildChunkSetInputSchema,
  RevokeChunkSetsInputSchema,
  type BuildChunkSetInput,
  type BuildChunkSetResult,
  type QKnowledgeDependencies,
  type RebuildChunkSetInput,
  type RevokeChunkSetsInput,
} from "./application/use-cases.js";
export {
  createChunkEmbeddingProcessor,
  type ChunkEmbedding,
  type ChunkEmbeddingProcessorDependencies,
  type EmbedChunkSetInput,
  type EmbedChunkSetResult,
} from "./application/chunk-embedding.js";
export {
  createQKnowledgeService,
  type QKnowledgeService,
  type QKnowledgeServiceOptions,
} from "./application/service.js";
export type {
  ChunkEmbeddingRepository,
  SemanticSearchPort,
} from "./application/embedding-ports.js";
export {
  createEmbeddingPersistenceService,
  documentEmbeddingIdentity,
  type EmbedChunksResult,
  type EmbeddingPersistenceDependencies,
  type EmbeddingPersistenceService,
  type PersistedEmbedding,
} from "./application/embedding-persistence.js";
export {
  createPostgresChunkEmbeddingRepository,
  createPostgresSemanticSearch,
} from "./infrastructure/postgres-embedding-repository.js";
export * from "./retrieval/contracts.js";
export {
  assembleAuthorisedFacts,
  describeLocator,
  describeRetrieval,
  describeSource,
} from "./retrieval/assembler.js";
export {
  envelopeFromPlan,
  envelopeIsCurrent,
  retrievalConstraintsFor,
} from "./retrieval/envelope.js";
export {
  fuseByReciprocalRank,
  type FusedItem,
  type FuseOptions,
  type FusionInput,
} from "./retrieval/fusion.js";
export type {
  AuthorisedCorpusScope,
  ChunkHydrationPort,
  HydratedChunk,
  HydrationQuery,
  LexicalCandidate,
  LexicalSearchPort,
  LexicalSearchQuery,
} from "./retrieval/ports.js";
export {
  createAuthorisedRetrievalService,
  RetrievalCancelledError,
  StaleRetrievalEnvelopeError,
  type AuthorisedRetrievalDependencies,
  type AuthorisedRetrievalService,
} from "./retrieval/service.js";
export {
  createPostgresChunkHydration,
  createPostgresLexicalSearch,
} from "./infrastructure/postgres-retrieval-repository.js";
export {
  createQEvidenceRetrieval,
  type QAuthorisedEvidenceContext,
  type QEvidenceRetrieval,
  type QEvidenceRetrievalDependencies,
} from "./q/evidence-retrieval.js";
export {
  createPostgresChunkRepository,
  createPostgresChunkSetRepository,
  createPostgresQKnowledgeRepositories,
} from "./infrastructure/postgres-chunk-repositories.js";

export const PACKAGE_NAME = "@capital-q/q-knowledge" as const;
