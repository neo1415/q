# Telemetry is a no-op

Why included: No SDK/exporter registered: spans and metrics are discarded.

## `packages/observability/src/telemetry.ts` lines 1-70

```ts
    1  import {
    2    metrics,
    3    trace,
    4    isSpanContextValid,
    5    type Meter,
    6    type Tracer,
    7  } from "@opentelemetry/api";
    8  
    9  const DEFAULT_SCOPE = "@capital-q/observability";
   10  
   11  /**
   12   * OpenTelemetry is Capital Q's vendor-neutral instrumentation contract
   13   * (TEO-050). This module owns the API surface so domain code never imports
   14   * OpenTelemetry directly and no backend is baked in.
   15   *
   16   * IMPORTANT — nothing is exported anywhere yet. Without a registered SDK the
   17   * OpenTelemetry API returns no-op tracers and meters: spans are created and
   18   * discarded. That is the intended state for this packet. The SDK, OTLP exporter
   19   * and collector arrive with the operations packets, at which point this API
   20   * begins producing real telemetry with no change to calling code.
   21   */
   22  export const TELEMETRY_EXPORT_ENABLED = false;
   23  
   24  export function getTracer(
   25    name: string = DEFAULT_SCOPE,
   26    version?: string,
   27  ): Tracer {
   28    return trace.getTracer(name, version);
   29  }
   30  
   31  export function getMeter(
   32    name: string = DEFAULT_SCOPE,
   33    version?: string,
   34  ): Meter {
   35    return metrics.getMeter(name, version);
   36  }
   37  
   38  /**
   39   * Trace identifiers for the active span, or undefined when none is active.
   40   *
   41   * Never fabricates identifiers: with no SDK registered the active span context
   42   * is invalid and both fields are omitted rather than filled with zeros.
   43   */
   44  export function getActiveTraceContext():
   45    { readonly traceId: string; readonly spanId: string } | undefined {
   46    const spanContext = trace.getActiveSpan()?.spanContext();
   47  
   48    if (spanContext === undefined || !isSpanContextValid(spanContext)) {
   49      return undefined;
   50    }
   51  
   52    return { traceId: spanContext.traceId, spanId: spanContext.spanId };
   53  }
   54  
   55  /**
   56   * Lifecycle contract for the observability subsystem.
   57   *
   58   * `start` is currently a no-op and `shutdown` has nothing to flush. The
   59   * contract exists now so that adding an exporter later — which does need
   60   * startup and a flush on termination — does not require touching every
   61   * deployable's composition root.
   62   */
   63  export type ObservabilityRuntime = {
   64    start(): Promise<void>;
   65    shutdown(): Promise<void>;
   66  };
   67  
   68  export function createTelemetryRuntime(): ObservabilityRuntime {
   69    return {
   70      start(): Promise<void> {
```

## `packages/observability/src/correlation.ts` lines 1-19

```ts
    1  import { randomUUID } from "node:crypto";
    2  
    3  /**
    4   * Diagnostic identifiers. These are opaque correlation handles, not domain
    5   * entity identifiers, and they carry no authority: the presence of a tenantId
    6   * in a logging context never implies the caller is authorized for that tenant.
    7   *
    8   * Inbound `X-Request-Id` and correlation headers are untrusted external input.
    9   * They are not accepted here; HTTP propagation is governed by Document 22 and
   10   * arrives with the API contract packets. Until then IDs are server-generated.
   11   */
   12  
   13  export function createRequestId(): string {
   14    return `req_${randomUUID()}`;
   15  }
   16  
   17  export function createCorrelationId(): string {
   18    return `cor_${randomUUID()}`;
   19  }
```

