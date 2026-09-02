/**
 * Capital Q worker runtime — persistent Node workload boundary (doc 23, 10).
 *
 * The worker deployable has no public health endpoint (doc 21, 164) and is not
 * publicly addressable.
 *
 * No queue exists yet. Supabase Queues/pgmq is the locked mechanism and is
 * integrated by a later packet, along with the job registry that dispatches by
 * job type and version. Deliberately absent here: any queue abstraction, poll
 * loop or broker client.
 */

import { CONTRACTS_VERSION } from "@capital-q/contracts";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";

const SERVICE_NAME = "workers";

// Validated once at startup, never per job.
const config = loadWorkerConfig();

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

// Scaffolding (doc 23, 222): with no queue consumer registered there is nothing
// holding the event loop open, so this timer keeps the process resident and
// behaving as the long-running workload it will be. It is removed once the
// first real consumer is registered.
const resident = setInterval(() => {}, 60_000);

function shutdown(signal: NodeJS.Signals): void {
  clearInterval(resident);
  logger.info({ signal }, "worker runtime stopped");

  // Nothing to flush yet. Once a telemetry exporter is registered, shutdown
  // becomes the point where buffered spans and metrics are drained.
  void telemetry.shutdown();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Future job handlers derive a child logger carrying jobId, correlationId and
// tenantId through the observability context rather than threading them by hand.
logger.info({ contracts: CONTRACTS_VERSION }, "worker runtime started");
