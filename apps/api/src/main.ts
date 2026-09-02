/**
 * Capital Q application API — deployable composition root (doc 23, 8; ERA-002).
 *
 * This is the service skeleton only. Domain routes, the auth/session boundary
 * and webhook handling are introduced by later packets; business logic is
 * imported from domain packages rather than written here.
 */

import { loadApiConfig } from "@capital-q/config/api";
import { createTelemetryRuntime } from "@capital-q/observability";

import { createApp } from "./app.js";

// Configuration is validated once here at the composition root. Invalid
// configuration fails startup rather than surfacing as a runtime error later.
const config = loadApiConfig();

const telemetry = createTelemetryRuntime();
await telemetry.start();

const { app, logger } = createApp(config);

await app.listen({
  port: config.network.port,
  host: config.network.host,
});

// Safe startup metadata only. The configuration object is never logged.
logger.info(
  { host: config.network.host, port: config.network.port },
  "service started",
);
