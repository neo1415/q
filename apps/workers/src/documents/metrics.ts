import { getMeter } from "@capital-q/observability";

import type { PipelineMetrics } from "./pipeline.js";

/**
 * Processing counters (doc 24 §79).
 *
 * Dimensions are categories only: an outcome code and an extractor id, both
 * drawn from small fixed sets. No tenant, no organisation, no document, no
 * filename — those are unbounded, and what a particular company uploaded is
 * not an operational measurement.
 */
export function createPipelineMetrics(): PipelineMetrics {
  const meter = getMeter("@capital-q/workers");
  const outcomes = meter.createCounter("document_processing_outcomes_total");
  const duration = meter.createHistogram(
    "document_processing_duration_milliseconds",
  );
  // Chunk counts per document (CQ-RAG-001 §66): a size distribution, never
  // a document identity.
  const chunks = meter.createHistogram("document_chunks_per_document");

  return {
    observe: (event) => {
      const attributes = {
        outcome: event.outcome,
        ...(event.extractorId === undefined
          ? {}
          : { extractor: event.extractorId }),
      };
      outcomes.add(1, attributes);
      duration.record(event.durationMs, attributes);
      if (event.chunkCount !== undefined) {
        chunks.record(event.chunkCount, attributes);
      }
    },
  };
}
