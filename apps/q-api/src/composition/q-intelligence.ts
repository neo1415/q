import { loadEmbeddingConfig } from "@capital-q/config/embeddings";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createModelGatewayQAnswer } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createEmbeddingService,
  createLocalTeiEmbeddingProvider,
  QWEN3_EMBEDDING_CONFIGURATION,
  type EmbeddingService,
} from "@capital-q/q-embeddings";
import {
  createAuthorisedRetrievalService,
  createKnowledgeQueryService,
  createPostgresChunkHydration,
  createPostgresKnowledgeRepository,
  createPostgresLexicalSearch,
  createPostgresSemanticSearch,
  createQEvidenceRetrieval,
} from "@capital-q/q-knowledge";
import type {
  QAnswerPort,
  QRetrievalPort,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import {
  createCompanyIntelligenceSpecialist,
  createKnowledgeCompanyPort,
  createRetrievalEvidencePort,
  createSpecialistQAnswer,
  createToolCanonicalPort,
} from "@capital-q/q-specialists";

/**
 * Q's intelligence composition (CQ-C5-R1 §6-§12).
 *
 * The C5 checkpoint found that every Wave-5 capability was real, tested
 * and composed nowhere: `apps/q-api` wired `createUnconfiguredQRetrieval()`
 * and gave the answer seam no context port, so the deployed product
 * answered with zero authorised facts. This module is that gap closed.
 *
 * It builds one path and returns the two ports the orchestrator takes:
 *
 *   Context Firewall plan
 *     → retrieval seam        does this plan reach ANY source material?
 *     → answer seam           specialist if the question is a company
 *                             investigation, conversational otherwise
 *         → authorised context: canonical state (tools) → authorised
 *           Q Knowledge → authorised hybrid retrieval
 *         → Model Gateway
 *
 * Every read below is constrained by the plan the firewall produced, and
 * nothing here decides a permission: the tool registry authorises canonical
 * reads, and the knowledge and retrieval services each re-apply the plan's
 * envelope in SQL. Composition is all this file does — no business logic,
 * no query, no credential handed onward.
 *
 * The seams are exactly the ones the CQ-Q-020 developer smoke has been
 * exercising since that packet, with one deliberate difference: sensitivity
 * is `FROM_PLAN` here. The smoke may declare its inputs synthetic; a
 * production run may not, so provider eligibility is decided from the
 * plan's own ceiling before any provider is contacted.
 */

export type QIntelligenceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repositories: QRuntimeRepositories;
  /** The Safe Read tools, already composed. Canonical state is read through them. */
  readonly tools: QToolPort;
  readonly gateway: ModelGateway;
  /**
   * Query embeddings. Absent retrieves lexically and reports the
   * degradation; it never reaches for a paid embedding API instead.
   */
  readonly embeddings?: EmbeddingService | undefined;
  readonly logger?: Logger | undefined;
};

/**
 * What this composition can honestly do, for the startup log and the
 * capability check. Booleans about wiring, never about a run's outcome.
 */
export type QIntelligenceCapabilities = {
  readonly authorisedRetrieval: boolean;
  readonly knowledgeQuery: boolean;
  readonly companyIntelligence: boolean;
  readonly semanticRetrieval: boolean;
};

export type QIntelligenceComposition = {
  readonly retrieval: QRetrievalPort;
  readonly answer: QAnswerPort;
  readonly capabilities: QIntelligenceCapabilities;
};

/**
 * The production query-embedding service, over the local runtime that holds
 * document text on a private network (CQ-RAG-002).
 *
 * The configuration is the one chunks were embedded under; a query embedded
 * under a different model would search a space nothing was indexed in. The
 * runtime being unreachable is a per-request degradation the retrieval
 * service already reports — not a reason to withhold the port, and not a
 * reason to start without one.
 */
export function createProductionEmbeddingService(): EmbeddingService {
  const config = loadEmbeddingConfig();
  return createEmbeddingService({
    provider: createLocalTeiEmbeddingProvider({
      baseUrl: config.baseUrl,
      configuration: {
        ...QWEN3_EMBEDDING_CONFIGURATION,
        maxBatchItems: config.maxBatchItems,
      },
      timeoutMs: config.timeoutMs,
    }),
  });
}

export function composeQIntelligence(
  dependencies: QIntelligenceDependencies,
): QIntelligenceComposition {
  const {
    sql,
    transactions,
    repositories,
    tools,
    gateway,
    embeddings,
    logger,
  } = dependencies;

  // Authorised hybrid retrieval (CQ-RAG-004). Lexical and semantic are
  // parallel components of one step, each already constrained in SQL by the
  // plan's envelope before ranking; fusion admits nothing new.
  const hydration = createPostgresChunkHydration();
  const retrievalService = createAuthorisedRetrievalService({
    sql,
    lexical: createPostgresLexicalSearch(),
    semantic: createPostgresSemanticSearch(),
    hydration,
    ...(embeddings === undefined ? {} : { embeddings }),
    ...(logger === undefined ? {} : { logger }),
  });

  // Authorised Q Knowledge (CQ-KNW-002, CQ-KNW-003). What Capital Q
  // currently understands, read under the same envelope, with confidence
  // and freshness travelling beside every statement.
  const knowledge = createKnowledgeQueryService({
    sql,
    knowledge: createPostgresKnowledgeRepository(),
    ...(logger === undefined ? {} : { logger }),
  });

  const evidence = createQEvidenceRetrieval({
    sql,
    repositories,
    retrieval: retrievalService,
    hydration,
    knowledge,
    ...(logger === undefined ? {} : { logger }),
  });

  // The conversational answer path, now holding the real authorised context
  // port instead of falling through to `noAuthorisedContext`.
  const conversational = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql,
    transactions,
    tools,
    context: evidence.context,
    ...(logger === undefined ? {} : { logger }),
  });

  // Company Intelligence (CQ-Q-020) behind the same seam. A person never
  // selects it and never learns it ran: `supports()` decides, and a request
  // it does not support goes to the conversational path unchanged.
  const specialist = createCompanyIntelligenceSpecialist({
    gateway,
    canonical: createToolCanonicalPort(tools, logger),
    knowledge: createKnowledgeCompanyPort(knowledge),
    evidence: createRetrievalEvidencePort(retrievalService, logger),
    // The plan's ceiling, never a declaration made at composition time.
    sensitivity: { kind: "FROM_PLAN" },
    ...(logger === undefined ? {} : { logger }),
  });

  const answer = createSpecialistQAnswer({
    specialist,
    delegate: conversational,
    repositories,
    sql,
    transactions,
    ...(logger === undefined ? {} : { logger }),
  });

  return {
    retrieval: evidence.port,
    answer,
    capabilities: {
      authorisedRetrieval: true,
      knowledgeQuery: true,
      companyIntelligence: true,
      semanticRetrieval: embeddings !== undefined,
    },
  };
}
