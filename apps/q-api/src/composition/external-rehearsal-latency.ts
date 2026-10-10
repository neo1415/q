/**
 * Latency of the external-person rehearsal, in memory: persona preparation,
 * first audio and per-turn latency, with p50/p95 over the last samples.
 * Numbers only (no content): safe to log and to read back from an ops view.
 */
export const EXTERNAL_REHEARSAL_METRICS = [
  "persona_preparation_ms",
  "first_audio_ms",
  "turn_latency_ms",
] as const;
export type ExternalRehearsalMetric =
  (typeof EXTERNAL_REHEARSAL_METRICS)[number];

export type LatencySummary = {
  readonly count: number;
  readonly p50: number | null;
  readonly p95: number | null;
};

export type ExternalRehearsalLatency = {
  readonly record: (metric: ExternalRehearsalMetric, ms: number) => void;
  readonly summary: (metric: ExternalRehearsalMetric) => LatencySummary;
};

const KEPT = 500;

/** Nearest-rank percentile of a sorted list. */
export function percentile(
  sorted: readonly number[],
  p: number,
): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export function createExternalRehearsalLatency(
  onSample?: (metric: ExternalRehearsalMetric, ms: number) => void,
): ExternalRehearsalLatency {
  const samples = new Map<ExternalRehearsalMetric, number[]>();
  return {
    record: (metric, ms) => {
      if (!Number.isFinite(ms) || ms < 0 || ms > 10 * 60_000) return;
      const kept = samples.get(metric) ?? [];
      kept.push(Math.round(ms));
      if (kept.length > KEPT) kept.shift();
      samples.set(metric, kept);
      onSample?.(metric, Math.round(ms));
    },
    summary: (metric) => {
      const sorted = [...(samples.get(metric) ?? [])].sort((a, b) => a - b);
      return {
        count: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
      };
    },
  };
}
