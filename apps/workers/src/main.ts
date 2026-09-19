/**
 * Capital Q worker runtime — persistent Node workload boundary (doc 23, 10).
 *
 * The worker deployable has no public health endpoint (doc 21, 164) and is not
 * publicly addressable.
 *
 * It runs three loops. The outbox publisher moves committed domain events onto
 * the durable pgmq `domain-events` queue. A domain-event consumer turns
 * `evidence.document.version_created` into an `evidence.document.process` job.
 * The documents consumer runs that job: security gate, malware gate, isolated
 * parse, structured extraction, structure-aware chunking (CQ-RAG-001),
 * `evidence.document.ready`.
 *
 * This process holds the database and the storage credential. The parser does
 * not: it runs in a child process with a scrubbed environment, which is what
 * makes a hostile document a data problem instead of a credential problem.
 */

import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadEmbeddingConfig } from "@capital-q/config/embeddings";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { CONTRACTS_VERSION } from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createOutboxPublisher,
  createOutboxRetryPolicy,
  createPgmqEventDispatcher,
} from "@capital-q/eventing/publisher";
import {
  createRecommendationPipeline,
  createRefreshRequester,
  createSlateInvalidationService,
  RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE,
  RECOMMENDATION_REFRESH_QUEUE,
  refreshDirectiveFor,
  RefreshRecommendationSlateJob,
} from "@capital-q/discovery";
import { createOutboxWriter, DOMAIN_EVENTS_QUEUE } from "@capital-q/eventing";
import {
  createDocumentProcessingService,
  createPostgresEvidenceRepositories,
  createSupabaseDocumentStorageProvider,
} from "@capital-q/evidence";
import {
  createFounderDocumentReview,
  createFounderExtraction,
} from "@capital-q/founder-onboarding";
import {
  createMandateReview,
  createMandateSynthesis,
} from "@capital-q/investor-onboarding";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  createEmbeddingService,
  createLocalTeiEmbeddingProvider,
  QWEN3_EMBEDDING_CONFIGURATION,
} from "@capital-q/q-embeddings";
import {
  createPostgresTaxonomyLexicalSearchRepository,
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyCandidateFinder,
  createTaxonomyClassifier,
} from "@capital-q/taxonomy";
import { modelProviderConfigStatus } from "@capital-q/config/model-providers";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import {
  createOnboardingService,
  createPostgresOnboardingResponseRepository,
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingSuggestionRepository,
  createPostgresOnboardingUtteranceRepository,
} from "@capital-q/onboarding";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";
import {
  createPostgresChunkRepository,
  createQKnowledgeService,
} from "@capital-q/q-knowledge";

import { createDocumentProcessingPipeline } from "./documents/pipeline.js";
import { createPipelineMetrics } from "./documents/metrics.js";
import { createUnavailableMalwareScanner } from "./documents/malware.js";
import { createDomainEventHandler } from "./events/document-processing-handler.js";
import { createProductionEventRegistry } from "./event-registry.js";
import { createOutboxPublisherRunner } from "./outbox-runner.js";
import { createParserSandbox } from "./parser/sandbox.js";
import { createPostgresBuildPrincipalResolver } from "./recommendations/build-principal.js";
import { createRecommendationRefreshHandler } from "./recommendations/refresh-handler.js";
import { EXTRACTION_PARSER_LIMITS } from "./parser/limits.js";
import {
  createPgmqQueueClient,
  DOCUMENTS_DEAD_LETTER_QUEUE,
  DOCUMENTS_QUEUE,
} from "./queue/pgmq.js";
import { createQueueRunner } from "./queue/runner.js";

const SERVICE_NAME = "workers";

// Validated once at startup, never per job.
const config = loadWorkerConfig();
const databaseConfig = loadDatabaseConfig();

const telemetry = createTelemetryRuntime();
await telemetry.start();

const logger = createLogger(
  {
    serviceName: SERVICE_NAME,
    environment: config.runtime.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion,
    region: config.observability.region,
  },
  { level: config.observability.logLevel },
);

// The publisher writes outbox bookkeeping and the queue: ordinary server
// access, no elevation required.
const database = createRequestDatabaseClient(databaseConfig);
const registry = createProductionEventRegistry();
const queues = createPgmqQueueClient(database.sql);

const runner = createOutboxPublisherRunner({
  publisher: createOutboxPublisher({
    transactions: database.transactions,
    registry,
    dispatcher: createPgmqEventDispatcher(),
    retryPolicy: createOutboxRetryPolicy({
      maxAttempts: config.outbox.maxAttempts,
    }),
  }),
  batchSize: config.outbox.batchSize,
  pollIntervalMs: config.outbox.pollIntervalMs,
  logger,
});

/**
 * Founder Onboarding Q (CQ-Q-021), finally reachable (CQ-C5-R2B §7).
 *
 * The worker composes one governed model call — the same Model Gateway,
 * the same catalogue, the same reviewed provider ceilings the Q service uses
 * — and the founder-onboarding review service that turns a processed
 * document into onboarding suggestions. With no provider key configured the
 * whole thing is absent: documents still process, and onboarding continues
 * without a review rather than stalling on one.
 */
const providerSecrets = config.secrets.modelProviders;
const modelProviders: ModelProvider[] = [];
if (providerSecrets.google !== undefined) {
  modelProviders.push(
    createGoogleModelProvider({ apiKey: providerSecrets.google.reveal() }),
  );
}
if (providerSecrets.groq !== undefined) {
  modelProviders.push(
    createGroqModelProvider({
      apiKey: providerSecrets.groq.reveal(),
      additionalApiKeys: providerSecrets.groqKeys
        .slice(1)
        .map((key) => key.reveal()),
    }),
  );
}

const modelGateway = createModelGateway({
  catalog: createPostgresModelCatalog({ sql: database.sql }),
  registry: createModelProviderRegistry(modelProviders),
  usage: createPostgresModelUsageRepository({ sql: database.sql }),
  health: createProcessLocalProviderHealth(),
  logger,
});

// One onboarding service for the worker. Its `internal` operations are the
// trusted, never-browser-reachable ones; nothing here registers a write
// handler, so a suggestion can only ever be an offer.
const onboarding = createOnboardingService({
  sql: database.sql,
  transactions: database.transactions,
  outbox: createOutboxWriter({ registry }),
  logger,
});

const founderReview =
  modelProviders.length === 0
    ? undefined
    : createFounderDocumentReview({
        sql: database.sql,
        documents: createPostgresEvidenceRepositories().documents,
        chunks: createPostgresChunkRepository(),
        sessions: createPostgresOnboardingSessionRepository(),
        responses: createPostgresOnboardingResponseRepository(),
        suggestions: createPostgresOnboardingSuggestionRepository(),
        utterances: createPostgresOnboardingUtteranceRepository(),
        createSuggestion: (command) =>
          onboarding.internal.createSuggestion(command as never),
        recordQuestions: (command) =>
          onboarding.internal.recordInterviewQuestions(command as never),
        extraction: createFounderExtraction({
          // The extraction declares the narrow slice of the gateway it uses
          // — one task class, one output shape — which is deliberately not
          // the gateway's full signature. Bridging the two is exactly what a
          // composition root is for; no behaviour is changed and no policy is
          // bypassed, because the object on the right is the real gateway.
          gateway: {
            execute: (request, options) =>
              modelGateway.execute(request as never, options as never),
          },
          // One place decides what a task class may cost and how long it may
          // take; a caller inventing its own budget would be a second,
          // quieter answer to a question the gateway already governs.
          budget: budgetForTaskClass("STRUCTURED_EXTRACTION"),
          logger,
        }),
        logger,
      });

/**
 * Investor Mandate Q (CQ-Q-022), finally reachable (CQ-PRE-REC-001 §6).
 * One governed call per narrative answer, through the same gateway and
 * ceilings; the reading becomes onboarding suggestions and questions on
 * the real investor steps. Taxonomy phrases resolve through Capital Q's own
 * deterministic classifier, never the model.
 */
const taxonomyClassifier = createTaxonomyClassifier({
  reference: createPostgresTaxonomyReferenceRepository(),
  lexical: createPostgresTaxonomyLexicalSearchRepository(),
});
const taxonomyCandidates = createTaxonomyCandidateFinder({
  sql: database.sql,
  classifier: taxonomyClassifier,
  logger,
});
const mandateReview =
  modelProviders.length === 0
    ? undefined
    : createMandateReview({
        sql: database.sql,
        sessions: createPostgresOnboardingSessionRepository(),
        responses: createPostgresOnboardingResponseRepository(),
        suggestions: createPostgresOnboardingSuggestionRepository(),
        utterances: createPostgresOnboardingUtteranceRepository(),
        synthesis: createMandateSynthesis({
          gateway: {
            execute: (request, options) =>
              modelGateway.execute(request as never, options as never),
          },
          budget: budgetForTaskClass("STRUCTURED_EXTRACTION"),
          logger,
        }),
        taxonomy: {
          resolve: async (phrase, vocabularyCodes) => {
            const result = await taxonomyCandidates.findCandidates({
              text: phrase,
              vocabularyCodes: vocabularyCodes,
              limit: 3,
            });
            // Only a confident, unambiguous resolution becomes a criterion:
            // a phrase that could mean several categories is left for the
            // investor's own search rather than guessed.
            if (result.resolution === "EXACT") {
              return result.candidates.map((c) => String(c.nodeId));
            }
            if (result.resolution === "CANDIDATES") {
              const [top] = result.candidates;
              return top === undefined ? [] : [String(top.nodeId)];
            }
            return [];
          },
        },
        createSuggestion: (command) =>
          onboarding.internal.createSuggestion(command as never),
        recordQuestions: (command) =>
          onboarding.internal.recordInterviewQuestions(command as never),
        logger,
      });

logger.info(
  {
    modelProviders: modelProviderConfigStatus(providerSecrets),
    founderReview: founderReview === undefined ? "disabled" : "composed",
    mandateReview: mandateReview === undefined ? "disabled" : "composed",
  },
  "founder onboarding review composed",
);

/**
 * Persisted recommendation slates (CQ-REC-006). The same pipeline
 * composition the API serves from, over the same disclosure evaluator the
 * Q service uses. The embedding runtime is the local one q-api reads
 * (Q_EMBEDDING_*): when it cannot be reached, the semantic generator
 * degrades and the slate says so; nothing here calls a hosted model.
 * Domain events become invalidations and coalesced refresh requests; the
 * refresh queue turns those into builds.
 */
const relationshipRepository = createPostgresRelationshipRepository();
const relationshipEventRepository = createPostgresRelationshipEventRepository();
const relationships: RelationshipQueryPort = {
  getById: (relationshipId) =>
    relationshipRepository.findById(database.sql, relationshipId),
  findByParties: (companyId, investorOrganisationId) =>
    relationshipRepository.findByParties(
      database.sql,
      companyId,
      investorOrganisationId,
    ),
  listEvents: (relationshipId, page = {}) =>
    relationshipEventRepository.listByRelationship(
      database.sql,
      relationshipId,
      {
        afterSequence: page.afterSequence,
        limit: page.limit ?? 100,
      },
    ),
  getEventById: (relationshipEventId) =>
    relationshipEventRepository.findById(database.sql, relationshipEventId),
};
const disclosurePorts = {
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  investors: createPostgresInvestorOrganisationQueryPort({ sql: database.sql }),
  mandates: createPostgresInvestorMandateQueryPort({ sql: database.sql }),
  capital: createPostgresCapitalObjectiveQueryPort({ sql: database.sql }),
  relationships,
};
const disclosure = createDisclosureAccessService({
  sql: database.sql,
  policies: createPostgresDisclosurePolicyRepository(),
  resolvers: createDisclosureResourceResolverRegistry(
    createDefaultDisclosureResolvers(disclosurePorts),
  ),
  relationshipParties: createRelationshipPartyResolver(disclosurePorts),
  clock: systemDisclosureClock,
});
const embeddingConfig = loadEmbeddingConfig();
const recommendations = createRecommendationPipeline({
  sql: database.sql,
  transactions: database.transactions,
  disclosure,
  embedder: createEmbeddingService({
    provider: createLocalTeiEmbeddingProvider({
      baseUrl: embeddingConfig.baseUrl,
      configuration: {
        ...QWEN3_EMBEDDING_CONFIGURATION,
        maxBatchItems: embeddingConfig.maxBatchItems,
      },
      timeoutMs: embeddingConfig.timeoutMs,
    }),
  }),
  logger,
});
const refreshRequester = createRefreshRequester({
  requests: recommendations.refreshRequests,
  queue: queues,
  logger,
});
const slateInvalidation = createSlateInvalidationService({
  slates: recommendations.slates,
  requester: refreshRequester,
  logger,
});
// Two builds at a time per process: each is a bounded pipeline run over
// the investor's pool. Queue identity and cadence are code constants.
const RECOMMENDATION_REFRESH_BATCH_SIZE = 2;
const RECOMMENDATION_REFRESH_POLL_INTERVAL_MS = 2_000;
const recommendationRefresh = createQueueRunner({
  queue: RECOMMENDATION_REFRESH_QUEUE,
  deadLetterQueue: RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE,
  client: queues,
  handle: createRecommendationRefreshHandler({
    builder: recommendations.builder,
    requests: recommendations.refreshRequests,
    principals: createPostgresBuildPrincipalResolver({ sql: database.sql }),
    queue: queues,
    logger,
  }),
  batchSize: RECOMMENDATION_REFRESH_BATCH_SIZE,
  pollIntervalMs: RECOMMENDATION_REFRESH_POLL_INTERVAL_MS,
  visibilityTimeoutSeconds:
    RefreshRecommendationSlateJob.retryPolicy.visibilityTimeoutSeconds,
  maxAttempts: RefreshRecommendationSlateJob.retryPolicy.maxAttempts,
  backoff: {
    initialDelaySeconds:
      RefreshRecommendationSlateJob.retryPolicy.backoff.initialDelaySeconds,
    maxDelaySeconds:
      RefreshRecommendationSlateJob.retryPolicy.backoff.maxDelaySeconds ?? 600,
    jitter: RefreshRecommendationSlateJob.retryPolicy.backoff.jitter ?? true,
  },
  logger,
});

const documentEvents = createQueueRunner({
  queue: DOMAIN_EVENTS_QUEUE,
  client: queues,
  handle: createDomainEventHandler({
    registry,
    queues,
    pipelineVersion: config.documents.pipelineVersion,
    ...(founderReview === undefined ? {} : { founderReview }),
    ...(mandateReview === undefined ? {} : { mandateReview }),
    recommendations: {
      onEvent: (event) =>
        slateInvalidation.apply(refreshDirectiveFor(event), {
          correlationId: event.correlationId,
          causationId: `cau_${event.id}`,
        }),
    },
    logger,
  }),
  batchSize: config.documents.batchSize,
  pollIntervalMs: config.documents.pollIntervalMs,
  visibilityTimeoutSeconds: 60,
  maxAttempts: 5,
  backoff: { initialDelaySeconds: 5, maxDelaySeconds: 300, jitter: true },
  logger,
});

/**
 * Storage authority is required for processing, and its absence closes the
 * pipeline rather than degrading it: a worker that cannot read a document
 * must not report that it processed one.
 */
const storage =
  config.public.supabaseUrl !== undefined &&
  config.secrets.supabaseSecretKey !== undefined
    ? createSupabaseDocumentStorageProvider({
        supabaseUrl: config.public.supabaseUrl,
        secretKey: config.secrets.supabaseSecretKey,
      })
    : undefined;

const documents =
  storage === undefined
    ? undefined
    : createQueueRunner({
        queue: DOCUMENTS_QUEUE,
        deadLetterQueue: DOCUMENTS_DEAD_LETTER_QUEUE,
        client: queues,
        handle: createDocumentProcessingPipeline({
          evidence: createDocumentProcessingService({
            sql: database.sql,
            transactions: database.transactions,
            outbox: createOutboxWriter({ registry }),
            storage,
          }),
          storage,
          // Derived chunks are written by the same worker, after the
          // extraction is recorded and before the run completes.
          knowledge: createQKnowledgeService({
            sql: database.sql,
            transactions: database.transactions,
            storage,
          }),
          // No scanner exists yet. Under the default policy this blocks
          // processing; it never reports a document clean.
          scanner: createUnavailableMalwareScanner(),
          malwarePolicy: config.documents.malwarePolicy,
          sandbox: createParserSandbox({
            timeoutMs: config.documents.parserTimeoutMs,
            maxOutputBytes: config.documents.parserMaxOutputBytes,
            maxOldSpaceMb: config.documents.parserMaxOldSpaceMb,
            limits: EXTRACTION_PARSER_LIMITS,
          }),
          pipelineVersion: config.documents.pipelineVersion,
          maxDocumentBytes: config.documents.maxDocumentBytes,
          metrics: createPipelineMetrics(),
          logger,
        }),
        batchSize: config.documents.batchSize,
        pollIntervalMs: config.documents.pollIntervalMs,
        visibilityTimeoutSeconds:
          ProcessDocumentJob.retryPolicy.visibilityTimeoutSeconds,
        maxAttempts: ProcessDocumentJob.retryPolicy.maxAttempts,
        backoff: {
          initialDelaySeconds:
            ProcessDocumentJob.retryPolicy.backoff.initialDelaySeconds,
          maxDelaySeconds:
            ProcessDocumentJob.retryPolicy.backoff.maxDelaySeconds ?? 900,
          jitter: ProcessDocumentJob.retryPolicy.backoff.jitter ?? true,
        },
        logger,
      });

if (documents === undefined) {
  logger.warn(
    {},
    "document processing disabled: no private storage credential configured",
  );
}

const shutdownController = new AbortController();

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "worker runtime stopping");
  shutdownController.abort();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info({ contracts: CONTRACTS_VERSION }, "worker runtime started");

// The loops hold the process resident; they return only after abort, at which
// point the pool is drained and telemetry flushed before exit.
await Promise.all([
  runner.run(shutdownController.signal),
  documentEvents.run(shutdownController.signal),
  recommendationRefresh.run(shutdownController.signal),
  ...(documents === undefined
    ? []
    : [documents.run(shutdownController.signal)]),
]);
await database.close();
await telemetry.shutdown();
logger.info({}, "worker runtime stopped");
