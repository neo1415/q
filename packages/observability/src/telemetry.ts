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
 * IMPORTANT — nothing is exported anywhere yet. Without a registered SDK the
 * OpenTelemetry API returns no-op tracers and meters: spans are created and
 * discarded. That is the intended state for this packet. The SDK, OTLP exporter
 * and collector arrive with the operations packets, at which point this API
 * begins producing real telemetry with no change to calling code.
 */
export const TELEMETRY_EXPORT_ENABLED = false;

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
 * Lifecycle contract for the observability subsystem.
 *
 * `start` is currently a no-op and `shutdown` has nothing to flush. The
 * contract exists now so that adding an exporter later — which does need
 * startup and a flush on termination — does not require touching every
 * deployable's composition root.
 */
export type ObservabilityRuntime = {
  start(): Promise<void>;
  shutdown(): Promise<void>;
};

export function createTelemetryRuntime(): ObservabilityRuntime {
  return {
    start(): Promise<void> {
      return Promise.resolve();
    },
    shutdown(): Promise<void> {
      return Promise.resolve();
    },
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
