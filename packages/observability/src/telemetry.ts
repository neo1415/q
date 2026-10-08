import {
  metrics,
  trace,
  isSpanContextValid,
  type Meter,
  type Tracer,
} from "@opentelemetry/api";

const DEFAULT_SCOPE = "@capital-q/observability";

/**
 * OpenTelemetry is Capital Q's vendor-neutral instrumentation contract
 * (TEO-050). This module owns the API surface so domain code never imports
 * OpenTelemetry directly and no backend is baked in.
 *
 * Export is OFF by default: without a registered SDK the OpenTelemetry API
 * returns no-op tracers and meters. RECOVERY F8 (audit F-D7) adds an opt-in:
 * with `CQ_TELEMETRY_EXPORT=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT` set, the
 * runtime's `start()` registers the OTLP/HTTP trace exporter, if the SDK
 * packages are installed. They are not dependencies yet (a lead decision:
 * `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`), so
 * today the opt-in reports UNAVAILABLE once on stderr and changes nothing.
 * No backend is chosen here and none is paid for.
 */
export const TELEMETRY_EXPORT_ENABLED = false;

export type TelemetryExportStatus = "OFF" | "ON" | "UNAVAILABLE";

/** The SDK, as far as this module needs it. */
export type TelemetrySdk = {
  start(): void | Promise<void>;
  shutdown(): Promise<void>;
};

export type TelemetrySdkLoader = () => Promise<TelemetrySdk>;

/** Whether this process was asked to export (env only; never a default). */
export function telemetryExportRequested(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    env["CQ_TELEMETRY_EXPORT"]?.trim().toLowerCase() === "otlp" &&
    (env["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim() ?? "") !== ""
  );
}

/**
 * Loads the SDK by name at runtime. The specifiers are variables on
 * purpose: the packages are optional, and a missing one must be a status,
 * not a build error or a crash.
 */
const loadOtlpSdk: TelemetrySdkLoader = async () => {
  const sdkName = "@opentelemetry/sdk-node";
  const exporterName = "@opentelemetry/exporter-trace-otlp-http";
  const sdkModule = (await import(sdkName)) as {
    NodeSDK: new (options: { traceExporter: unknown }) => TelemetrySdk;
  };
  const exporterModule = (await import(exporterName)) as {
    OTLPTraceExporter: new () => unknown;
  };
  // The exporter reads OTEL_EXPORTER_OTLP_ENDPOINT and _HEADERS itself.
  return new sdkModule.NodeSDK({
    traceExporter: new exporterModule.OTLPTraceExporter(),
  });
};

export function getTracer(
  name: string = DEFAULT_SCOPE,
  version?: string,
): Tracer {
  return trace.getTracer(name, version);
}

export function getMeter(
  name: string = DEFAULT_SCOPE,
  version?: string,
): Meter {
  return metrics.getMeter(name, version);
}

/**
 * Trace identifiers for the active span, or undefined when none is active.
 *
 * Never fabricates identifiers: with no SDK registered the active span context
 * is invalid and both fields are omitted rather than filled with zeros.
 */
export function getActiveTraceContext():
  { readonly traceId: string; readonly spanId: string } | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();

  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return undefined;
  }

  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

/**
 * Lifecycle contract for the observability subsystem. Every deployable
 * already calls `start` at boot and `shutdown` on termination, so turning
 * export on needs no composition change.
 */
export type ObservabilityRuntime = {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  /** After `start`: whether spans are being exported. */
  exportStatus(): TelemetryExportStatus;
};

export function createTelemetryRuntime(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
    readonly load?: TelemetrySdkLoader | undefined;
    readonly report?: ((line: string) => void) | undefined;
  } = {},
): ObservabilityRuntime {
  const env = options.env ?? process.env;
  const report =
    options.report ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });
  let sdk: TelemetrySdk | undefined;
  let status: TelemetryExportStatus = "OFF";
  return {
    async start(): Promise<void> {
      if (!telemetryExportRequested(env)) return;
      try {
        sdk = await (options.load ?? loadOtlpSdk)();
        await sdk.start();
        status = "ON";
      } catch {
        // Telemetry never stops a service from starting. One line, no
        // endpoint or header values.
        sdk = undefined;
        status = "UNAVAILABLE";
        report(
          JSON.stringify({
            level: "warn",
            msg: "telemetry export requested but the OpenTelemetry SDK is not available; continuing without export",
          }),
        );
      }
    },
    async shutdown(): Promise<void> {
      if (sdk === undefined) return;
      try {
        await sdk.shutdown();
      } catch {
        // A failed final flush is not a failed shutdown.
      }
    },
    exportStatus: () => status,
  };
}

/**
 * Identifiers that must NEVER become metric labels (TEO-052): userId, tenantId,
 * companyId, investorId, documentId, requestId, qRunId, jobId. Each is
 * unbounded and would produce a new time series per entity.
 *
 * They are acceptable in logs and trace attributes, where cardinality is not a
 * storage multiplier. Metric dimensions must stay bounded: service, route
 * template, status class, provider, model, task class, result.
 */
export const FORBIDDEN_METRIC_LABELS = [
  "userId",
  "tenantId",
  "organisationId",
  "companyId",
  "investorId",
  "documentId",
  "requestId",
  "correlationId",
  "qRunId",
  "jobId",
] as const;
