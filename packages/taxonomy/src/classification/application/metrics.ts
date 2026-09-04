import { getMeter, type Logger } from "@capital-q/observability";

import type { TaxonomyClassificationResult } from "../contracts/index.js";

/**
 * Safe classification telemetry. Metric labels are bounded (strategy,
 * resolution, abstention reason, classifier version, run status); never
 * input text, node ids, company or user ids. Log records carry lengths,
 * hashes and counts -- never the text.
 */

type Meter = ReturnType<typeof getMeter>;
type Counter = ReturnType<Meter["createCounter"]>;
type Histogram = ReturnType<Meter["createHistogram"]>;

type TaxonomyMetrics = {
  readonly requests: Counter;
  readonly resolutions: Counter;
  readonly latency: Histogram;
  readonly abstentions: Counter;
  readonly ambiguities: Counter;
  readonly persistentRuns: Counter;
  readonly failures: Counter;
};

let metrics: TaxonomyMetrics | undefined;

export function getTaxonomyMetrics(): TaxonomyMetrics {
  if (metrics === undefined) {
    const meter = getMeter("@capital-q/taxonomy");
    metrics = {
      requests: meter.createCounter("taxonomy_candidate_requests_total"),
      resolutions: meter.createCounter("taxonomy_candidate_resolution_total"),
      latency: meter.createHistogram("taxonomy_candidate_latency", {
        unit: "ms",
      }),
      abstentions: meter.createCounter("taxonomy_abstentions_total"),
      ambiguities: meter.createCounter("taxonomy_ambiguities_total"),
      persistentRuns: meter.createCounter("taxonomy_persistent_runs_total"),
      failures: meter.createCounter("taxonomy_classification_failures_total"),
    };
  }
  return metrics;
}

export type ClassificationObservation = {
  readonly strategy: string;
  readonly inputLength: number;
  readonly inputHash: string;
  readonly vocabularyCount: number;
  readonly durationMs: number;
  readonly result: TaxonomyClassificationResult;
};

export function observeClassification(
  observation: ClassificationObservation,
  logger: Logger | undefined,
): void {
  const m = getTaxonomyMetrics();
  const { result } = observation;
  const version = result.classifier.version;
  m.requests.add(1, {
    strategy: observation.strategy,
    classifierVersion: version,
  });
  m.resolutions.add(1, {
    strategy: observation.strategy,
    resolution: result.resolution,
    classifierVersion: version,
  });
  m.latency.record(observation.durationMs, { strategy: observation.strategy });
  if (result.resolution === "ABSTAINED") {
    m.abstentions.add(1, {
      reason: result.abstentionReason ?? "UNKNOWN",
      classifierVersion: version,
    });
  }
  if (result.resolution === "AMBIGUOUS") {
    m.ambiguities.add(1, { classifierVersion: version });
  }
  logger?.info(
    {
      classifierVersion: version,
      strategy: observation.strategy,
      inputLength: observation.inputLength,
      inputHash: observation.inputHash,
      vocabularyCount: observation.vocabularyCount,
      candidateCount: result.candidates.length,
      resolution: result.resolution,
      ...(result.abstentionReason === undefined
        ? {}
        : { abstentionReason: result.abstentionReason }),
      durationMs: observation.durationMs,
    },
    "taxonomy candidates resolved",
  );
}
