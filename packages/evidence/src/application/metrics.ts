import { getMeter } from "@capital-q/observability";

/**
 * Bounded upload counters. Dimensions are categories only — a failure code,
 * never a user, a tenant, a document, a filename or a storage key. What an
 * organisation uploaded is not an operational metric.
 */

type Meter = ReturnType<typeof getMeter>;
type Counter = ReturnType<Meter["createCounter"]>;

export type EvidenceMetrics = {
  readonly uploadSessionsCreated: Counter;
  readonly uploadsCompleted: Counter;
  readonly uploadsRejected: Counter;
  readonly uploadsExpired: Counter;
  readonly uploadBytes: Counter;
};

let metrics: EvidenceMetrics | undefined;

export function getEvidenceMetrics(): EvidenceMetrics {
  if (metrics === undefined) {
    const meter = getMeter("@capital-q/evidence");
    metrics = {
      uploadSessionsCreated: meter.createCounter(
        "document_upload_sessions_created_total",
      ),
      uploadsCompleted: meter.createCounter("document_uploads_completed_total"),
      uploadsRejected: meter.createCounter("document_uploads_rejected_total"),
      uploadsExpired: meter.createCounter("document_uploads_expired_total"),
      uploadBytes: meter.createCounter("document_upload_bytes_total"),
    };
  }
  return metrics;
}
