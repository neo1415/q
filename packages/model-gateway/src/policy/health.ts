import type {
  ModelFailureClass,
  ModelProviderCode,
} from "@capital-q/contracts";

import type { ProviderHealthPort, ProviderHealthState } from "../ports.js";

/**
 * Minimal, process-local provider health (doc 21 §92; packet §46).
 *
 * A provider that has failed with an availability class three times
 * within a minute is skipped for thirty seconds. That is all: no shared
 * state, no service discovery, no Redis, and — deliberately — no way for
 * this to make a provider eligible. It can only make an eligible provider
 * temporarily un-chosen, and a security decision never reads it.
 */

const AVAILABILITY_FAILURES: ReadonlySet<ModelFailureClass> = new Set([
  "PROVIDER_OUTAGE",
  "TIMEOUT",
  "RATE_LIMIT",
  "TRANSIENT",
]);

export type ProviderHealthOptions = {
  readonly failureThreshold?: number | undefined;
  readonly windowMs?: number | undefined;
  readonly openForMs?: number | undefined;
};

export function createProcessLocalProviderHealth(
  options: ProviderHealthOptions = {},
): ProviderHealthPort {
  const failureThreshold = options.failureThreshold ?? 3;
  const windowMs = options.windowMs ?? 60_000;
  const openForMs = options.openForMs ?? 30_000;
  const failures = new Map<ModelProviderCode, number[]>();
  const openUntil = new Map<ModelProviderCode, number>();

  const state = (code: ModelProviderCode, at: Date): ProviderHealthState => {
    const until = openUntil.get(code);
    if (until !== undefined && until > at.getTime()) {
      return "TEMPORARILY_FAILING";
    }
    return "HEALTHY";
  };

  return {
    state,
    recordFailure: (code, failureClass, at) => {
      if (!AVAILABILITY_FAILURES.has(failureClass)) {
        return;
      }
      const now = at.getTime();
      const recent = (failures.get(code) ?? []).filter(
        (t) => now - t <= windowMs,
      );
      recent.push(now);
      failures.set(code, recent);
      if (recent.length >= failureThreshold) {
        openUntil.set(code, now + openForMs);
        failures.set(code, []);
      }
    },
    recordSuccess: (code) => {
      failures.delete(code);
      openUntil.delete(code);
    },
  };
}

/** Always healthy; for tests and for compositions that opt out. */
export const alwaysHealthy: ProviderHealthPort = {
  state: () => "HEALTHY",
  recordFailure: () => undefined,
  recordSuccess: () => undefined,
};
