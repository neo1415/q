import type {
  ModelCode,
  ModelFailureClass,
  ModelProviderCode,
} from "@capital-q/contracts";

import type { ProviderHealthPort, ProviderHealthState } from "../ports.js";

/**
 * Minimal, process-local provider health (doc 21 §92; packet §46).
 *
 * One provider's ONE MODEL that has failed with an availability class
 * three times within a minute is skipped for thirty seconds. That is all:
 * no shared state, no service discovery, no Redis, and — deliberately —
 * no way for this to make anything eligible. It can only make an eligible
 * model temporarily un-chosen, and a security decision never reads it.
 *
 * Keyed by provider and model together, because a model being overloaded
 * says nothing about a sibling on the same account. Hosted, 2026-09-22:
 * `gemini-3.5-flash-lite` answered 503 three times, the whole of `google`
 * was taken out with it, and `gemini-3.8-flash` — eligible, and quite
 * possibly well — went too. Every provider was then either rate-limited
 * or shut off, the interview had no route at all, and the conversation
 * ended there.
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
  const failures = new Map<string, number[]>();
  const openUntil = new Map<string, number>();
  const keyOf = (code: ModelProviderCode, model: ModelCode): string =>
    `${code}\u0000${model}`;

  const state = (
    code: ModelProviderCode,
    model: ModelCode,
    at: Date,
  ): ProviderHealthState => {
    const until = openUntil.get(keyOf(code, model));
    if (until !== undefined && until > at.getTime()) {
      return "TEMPORARILY_FAILING";
    }
    return "HEALTHY";
  };

  return {
    state,
    recordFailure: (code, model, failureClass, at, elapsedMs) => {
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
      const key = keyOf(code, model);
      const now = at.getTime();
      const recent = (failures.get(key) ?? []).filter(
        (t) => now - t <= windowMs,
      );
      recent.push(now);
      failures.set(key, recent);
      if (recent.length >= failureThreshold) {
        openUntil.set(key, now + openForMs);
        failures.set(key, []);
      }
    },
    recordSuccess: (code, model) => {
      const key = keyOf(code, model);
      failures.delete(key);
      openUntil.delete(key);
    },
  };
}

/** Always healthy; for tests and for compositions that opt out. */
export const alwaysHealthy: ProviderHealthPort = {
  state: () => "HEALTHY",
  recordFailure: () => undefined,
  recordSuccess: () => undefined,
};
