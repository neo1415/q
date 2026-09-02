/**
 * Q runtime service — a separate deployable boundary, not a module of the
 * application API and not a component of the web app (TA-005, IDA-002;
 * doc 10, 6). Capital Q is a consumer of this service.
 *
 * This packet establishes the boundary and its HTTP failure contract only. The
 * Q runtime entry, orchestration composition, run lifecycle, provider
 * registration, tool registration and the SSE adapter (doc 23, 9) all arrive
 * with the Q track. Nothing here imports apps/api or apps/web, and nothing here
 * calls a model.
 */

import { loadQApiConfig } from "@capital-q/config/q-api";
import { createTelemetryRuntime } from "@capital-q/observability";

import { createApp } from "./app.js";

// Q configuration is loaded from its own schema, separate from the application
// API even where the current fields coincide.
const config = loadQApiConfig();

const telemetry = createTelemetryRuntime();
await telemetry.start();

const { app, logger } = createApp(config);

await app.listen({
  port: config.network.port,
  host: config.network.host,
});

logger.info(
  { host: config.network.host, port: config.network.port },
  "service started",
);
