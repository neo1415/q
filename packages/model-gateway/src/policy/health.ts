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

/**
 * How long an attempt must have run before its timeout says anything
 * about the provider.
 *
 * A timeout is two different events wearing one name. One is a provider
 * that has stopped answering. The other is a caller whose own budget was
 * shorter than this model's tail, which is news about the caller.
 *
 * Hosted, 2026-09-22: a spoken interview turn was given a twelve-second
 * model budget so that the turn could finish inside the voice route's own
 * twenty-second deadline. Gemini answers that turn in about a second
 * almost always and in sixteen occasionally. Three of the slow ones inside
 * a minute read as three availability failures, the breaker opened, and a
 * provider that was working perfectly well was taken out of rotation for
 * every task class — leaving the interview with no eligible route at all
 * while the only other provider was rate-limited. The conversation ended
 * there.
 *
 * So a timeout counts only when the caller waited at least this long. It
 * is deliberately below any budget a person is waiting on and above the
 * budgets that exist because a person is.
 */
const TIMEOUT_MEANS_UNHEALTHY_AFTER_MS = 20_000;

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
    recordFailure: (code, failureClass, at, elapsedMs) => {
      if (!AVAILABILITY_FAILURES.has(failureClass)) {
        return;
      }
      // Our own short budget expiring is not the provider's news.
      if (
        failureClass === "TIMEOUT" &&
        elapsedMs !== undefined &&
        elapsedMs < TIMEOUT_MEANS_UNHEALTHY_AFTER_MS
      ) {
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
