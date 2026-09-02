/**
 * Diagnostic identifiers and safe metadata attached to log records.
 *
 * This is operational telemetry, not business truth. A log entry never
 * substitutes for a domain event (Document 22) or an audit record: audit must
 * durably reconstruct who did what under whose authority, and logs are not that
 * system (TEO-053).
 */
export type ObservabilityContext = {
  /** One inbound request or unit of work. */
  readonly requestId?: string;
  /** Spans a workflow across HTTP, jobs, events and Q runs. */
  readonly correlationId?: string;

  readonly tenantId?: string;
  readonly organisationId?: string;

  readonly qRunId?: string;
  readonly jobId?: string;
};

/**
 * Structured fields for a single log record.
 *
 * Put identifiers and bounded operational values here. Never raw request or
 * response bodies, document contents, Q prompts or responses, credentials, or
 * personal data (ERA-143, TEO-054).
 *
 * An `err` key receives Pino's error serializer.
 */
export type LogContext = Readonly<Record<string, unknown>>;

export type Logger = {
  debug(context: LogContext, message: string): void;
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;

  /** Derive a logger carrying additional fixed fields. */
  child(context: LogContext): Logger;
};

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Resource metadata identifying the emitting service.
 *
 * Maps onto the OpenTelemetry resource attributes `service.name`,
 * `service.version` and `deployment.environment` when an SDK is introduced.
 */
export type ServiceIdentity = {
  readonly serviceName: string;
  readonly environment: string;
  /** Injected by CI/deployment as a git SHA or release id. Absent locally. */
  readonly serviceVersion?: string | undefined;
  readonly region?: string | undefined;
};
