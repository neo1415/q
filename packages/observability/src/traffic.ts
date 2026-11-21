/**
 * W1-B (enterprise audit 21 Nov 2026, finding 5): each service's requests
 * and server errors over a rolling window, in memory, counts only. The
 * OpenTelemetry export stays off (no exporter is configured and no paid
 * one is added); this is the error tracker in its place: a per-service
 * counter that the service's readiness answer carries, the console shows
 * and the workers' operational check reads to say an error-rate spike.
 * Never a route, a path, a person or a message: two numbers per minute.
 */
export type TrafficWindow = {
  /** The window the counts cover, in whole minutes. */
  readonly windowMinutes: number;
  readonly requests: number;
  /** Responses with a 5xx status. */
  readonly serverErrors: number;
};

export type TrafficCounter = {
  readonly record: (statusCode: number) => void;
  readonly read: () => TrafficWindow;
};

export const TRAFFIC_WINDOW_MS = 15 * 60_000;
const BUCKET_MS = 60_000;

export function createTrafficCounter(
  options: {
    readonly windowMs?: number | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): TrafficCounter {
  const windowMs = options.windowMs ?? TRAFFIC_WINDOW_MS;
  const now = options.now ?? Date.now;
  const slots = Math.max(1, Math.round(windowMs / BUCKET_MS));
  // One bucket per minute, keyed by the minute it started.
  const buckets = new Map<number, { requests: number; errors: number }>();
  const prune = (at: number) => {
    const oldest = Math.floor(at / BUCKET_MS) - slots + 1;
    for (const minute of buckets.keys()) {
      if (minute < oldest) buckets.delete(minute);
    }
  };
  return {
    record: (statusCode) => {
      const at = now();
      const minute = Math.floor(at / BUCKET_MS);
      const bucket = buckets.get(minute) ?? { requests: 0, errors: 0 };
      bucket.requests += 1;
      if (statusCode >= 500) bucket.errors += 1;
      buckets.set(minute, bucket);
      prune(at);
    },
    read: () => {
      prune(now());
      let requests = 0;
      let serverErrors = 0;
      for (const bucket of buckets.values()) {
        requests += bucket.requests;
        serverErrors += bucket.errors;
      }
      return { windowMinutes: slots, requests, serverErrors };
    },
  };
}
