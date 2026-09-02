/**
 * @capital-q/observability
 *
 * Owns: the technical observability primitives shared by every backend
 * deployable -- structured logging, correlation context, and the vendor-neutral
 * OpenTelemetry tracing/metrics boundary (ERA-050, TEO-050).
 *
 * Does not own, and must never become:
 *
 *   AUDIT      durable reconstruction of who acted under whose authority.
 *              A log line saying "document shared" does not satisfy audit.
 *   ANALYTICS  what users did. Observability answers what the system did.
 *   DOMAIN EVENTS  business truth. Domain state is never reconstructed from
 *              logs (Document 22 is authoritative).
 *
 * Those are separate systems with different retention, access and integrity
 * requirements (TEO-053).
 *
 * Server-only. This package depends on Node built-ins and Pino, and must not be
 * imported by browser code. Browser telemetry will arrive as its own surface.
 *
 * Logs are lower-trust operational metadata, not a convenient second data
 * store. Never copy business or private material into them because the logging
 * backend happens to be access-controlled.
 */

export {
  getObservabilityContext,
  runWithObservabilityContext,
  withObservabilityContext,
} from "./context.js";

export { createCorrelationId, createRequestId } from "./correlation.js";

export {
  createFrameworkLogger,
  createLogger,
  REDACTED_PLACEHOLDER,
  type CreateLoggerOptions,
} from "./logger.js";

export {
  createTelemetryRuntime,
  FORBIDDEN_METRIC_LABELS,
  getActiveTraceContext,
  getMeter,
  getTracer,
  TELEMETRY_EXPORT_ENABLED,
  type ObservabilityRuntime,
} from "./telemetry.js";

export {
  LOG_LEVELS,
  type LogContext,
  type Logger,
  type LogLevel,
  type ObservabilityContext,
  type ServiceIdentity,
} from "./types.js";
