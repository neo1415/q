/**
 * Capital Q worker runtime — persistent Node workload boundary (doc 23, 10).
 *
 * The worker deployable has no public health endpoint (doc 21, 164) and is not
 * publicly addressable.
 *
 * Today it runs one loop: the outbox publisher, which moves committed domain
 * events onto the durable pgmq `domain-events` queue. Consumers arrive with
 * the packets that own them and will register here alongside it.
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
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";

import { createProductionEventRegistry } from "./event-registry.js";
import { createOutboxPublisherRunner } from "./outbox-runner.js";

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

const runner = createOutboxPublisherRunner({
  publisher: createOutboxPublisher({
    transactions: database.transactions,
    registry: createProductionEventRegistry(),
    dispatcher: createPgmqEventDispatcher(),
    retryPolicy: createOutboxRetryPolicy({
      maxAttempts: config.outbox.maxAttempts,
    }),
  }),
  batchSize: config.outbox.batchSize,
  pollIntervalMs: config.outbox.pollIntervalMs,
  logger,
});

const shutdownController = new AbortController();

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "worker runtime stopping");
  shutdownController.abort();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info({ contracts: CONTRACTS_VERSION }, "worker runtime started");

// The loop holds the process resident; it returns only after abort, at which
// point the pool is drained and telemetry flushed before exit.
await runner.run(shutdownController.signal);
await database.close();
await telemetry.shutdown();
logger.info({}, "worker runtime stopped");
