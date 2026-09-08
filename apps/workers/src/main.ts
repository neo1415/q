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

import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { CONTRACTS_VERSION } from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createOutboxPublisher,
  createOutboxRetryPolicy,
  createPgmqEventDispatcher,
} from "@capital-q/eventing/publisher";
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
    createGroqModelProvider({ apiKey: providerSecrets.groq.reveal() }),
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
        createSuggestion: (command) =>
          onboarding.internal.createSuggestion(command as never),
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

logger.info(
  {
    modelProviders: modelProviderConfigStatus(providerSecrets),
    founderReview: founderReview === undefined ? "disabled" : "composed",
  },
  "founder onboarding review composed",
);

const documentEvents = createQueueRunner({
  queue: DOMAIN_EVENTS_QUEUE,
  client: queues,
  handle: createDomainEventHandler({
    registry,
    queues,
    pipelineVersion: config.documents.pipelineVersion,
    ...(founderReview === undefined ? {} : { founderReview }),
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
  ...(documents === undefined
    ? []
    : [documents.run(shutdownController.signal)]),
]);
await database.close();
await telemetry.shutdown();
logger.info({}, "worker runtime stopped");
