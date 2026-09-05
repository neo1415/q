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
 * parse, structured extraction, `evidence.document.ready`.
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
  createSupabaseDocumentStorageProvider,
} from "@capital-q/evidence";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";

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

const documentEvents = createQueueRunner({
  queue: DOMAIN_EVENTS_QUEUE,
  client: queues,
  handle: createDomainEventHandler({
    registry,
    queues,
    pipelineVersion: config.documents.pipelineVersion,
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
