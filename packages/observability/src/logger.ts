import { pino, type DestinationStream, type Logger as PinoLogger } from "pino";

import { getObservabilityContext } from "./context.js";
import { getActiveTraceContext } from "./telemetry.js";
import type { LogContext, LogLevel, Logger, ServiceIdentity } from "./types.js";

/**
 * Baseline redaction for field names that commonly carry credentials.
 *
 * This is a second line of defence, not the control. The primary rule is that
 * sensitive material is never passed to the logger in the first place: key-name
 * redaction cannot recognise a founder-private disclosure, a document body or a
 * Q prompt, because those have no distinguishing key name (ERA-143, TEO-054).
 */
const REDACTED_PATHS = [
  "password",
  "*.password",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "clientSecret",
  "*.clientSecret",
  "serviceRoleKey",
  "*.serviceRoleKey",
];

export const REDACTED_PLACEHOLDER = "[redacted]";

export type CreateLoggerOptions = {
  readonly level?: LogLevel;
  /** Test seam. Production writes structured JSON to stdout. */
  readonly destination?: DestinationStream;
};

/**
 * Fields present on every record from this service. Mirrors the OpenTelemetry
 * resource attributes an SDK will later carry (TEO-051).
 */
function baseFields(identity: ServiceIdentity): Record<string, string> {
  const base: Record<string, string> = {
    service: identity.serviceName,
    environment: identity.environment,
  };

  if (identity.serviceVersion !== undefined) {
    base["serviceVersion"] = identity.serviceVersion;
  }

  if (identity.region !== undefined) {
    base["region"] = identity.region;
  }

  return base;
}

/**
 * Merge the active correlation scope and active trace identifiers into a
 * record's fields, so callers never hand-thread requestId through every log
 * call. Explicit fields win over ambient ones.
 */
function enrich(context: LogContext): LogContext {
  return {
    ...getObservabilityContext(),
    ...getActiveTraceContext(),
    ...context,
  };
}

function wrap(pinoLogger: PinoLogger): Logger {
  return {
    debug(context, message) {
      pinoLogger.debug(enrich(context), message);
    },
    info(context, message) {
      pinoLogger.info(enrich(context), message);
    },
    warn(context, message) {
      pinoLogger.warn(enrich(context), message);
    },
    error(context, message) {
      pinoLogger.error(enrich(context), message);
    },
    child(context) {
      return wrap(pinoLogger.child({ ...context }));
    },
  };
}

/**
 * Create the structured logger for a service.
 *
 * Emits newline-delimited JSON to stdout. Logging performs no synchronous
 * network I/O; shipping logs onward is the platform's job.
 */
export function createLogger(
  identity: ServiceIdentity,
  options: CreateLoggerOptions = {},
): Logger {
  const pinoOptions = {
    level: options.level ?? "info",
    base: baseFields(identity),
    redact: { paths: REDACTED_PATHS, censor: REDACTED_PLACEHOLDER },
  };

  const pinoLogger =
    options.destination === undefined
      ? pino(pinoOptions)
      : pino(pinoOptions, options.destination);

  return wrap(pinoLogger);
}

/**
 * The underlying Pino instance, for frameworks that own their own logging
 * (Fastify). This is the single sanctioned place Pino crosses the package
 * boundary; application code uses the `Logger` interface so that Pino-specific
 * usage does not spread through the codebase.
 */
export function createFrameworkLogger(
  identity: ServiceIdentity,
  options: CreateLoggerOptions = {},
): PinoLogger {
  return pino({
    level: options.level ?? "info",
    base: baseFields(identity),
    redact: { paths: REDACTED_PATHS, censor: REDACTED_PLACEHOLDER },
  });
}
