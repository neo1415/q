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

/**
 * A provider whose ACCOUNT cannot serve (credit or quota exhausted) is
 * skipped, every model on it, for this long after one such answer; then
 * one attempt probes it again. Live 2026-10-01: OpenAI credit ran out and
 * every turn first spent two retries on it before falling back.
 */
const ACCOUNT_EXHAUSTED_OPEN_MS = 10 * 60_000;

/**
 * Round 8 (hosted Gemini 402, 2026-10-21): a 429 backs that one model off
 * at once, for the provider's Retry-After or this long, bounded; during it
 * the model is tried only when no other eligible model is left.
 */
const RATE_LIMIT_BACKOFF_MS = 15_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 60_000;

export type ProviderHealthOptions = {
  readonly failureThreshold?: number | undefined;
  readonly windowMs?: number | undefined;
  readonly openForMs?: number | undefined;
  readonly accountExhaustedOpenForMs?: number | undefined;
};

export function createProcessLocalProviderHealth(
  options: ProviderHealthOptions = {},
): ProviderHealthPort {
  const failureThreshold = options.failureThreshold ?? 3;
  const windowMs = options.windowMs ?? 60_000;
  const openForMs = options.openForMs ?? 30_000;
  const failures = new Map<string, number[]>();
  const openUntil = new Map<string, number>();
  const accountOpenForMs =
    options.accountExhaustedOpenForMs ?? ACCOUNT_EXHAUSTED_OPEN_MS;
  /** Provider-wide: every model on an exhausted account. */
  const accountOpenUntil = new Map<ModelProviderCode, number>();
  /** One model, after a 429: tried only as the last resort until then. */
  const backoffUntil = new Map<string, number>();

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
    const accountUntil = accountOpenUntil.get(code);
    if (accountUntil !== undefined && accountUntil > at.getTime()) {
      return "TEMPORARILY_FAILING";
    }
    const backoff = backoffUntil.get(keyOf(code, model));
    if (backoff !== undefined && backoff > at.getTime()) {
      return "BACKING_OFF";
    }
    return "HEALTHY";
  };

  return {
    state,
    recordFailure: (
      code,
      model,
      failureClass,
      at,
      elapsedMs,
      exhausted,
      retryAfterMs,
    ) => {
      const now = at.getTime();
      // An account that cannot pay does not heal by itself: every model on
      // it is skipped, so no turn pays the failed first attempt again
      // (hosted Gemini 402, 2026-10-21).
      if (exhausted === true) {
        accountOpenUntil.set(code, now + accountOpenForMs);
        return;
      }
      // A key the provider refused (401/403, after the adapter tried its
      // other keys) does not heal either; only this model is skipped, as a
      // refusal can be one model's (not enabled for the key).
      if (failureClass === "AUTHENTICATION") {
        openUntil.set(keyOf(code, model), now + accountOpenForMs);
        return;
      }
      if (failureClass === "RATE_LIMIT") {
        const key = keyOf(code, model);
        const forMs = Math.min(
          RATE_LIMIT_BACKOFF_MAX_MS,
          Math.max(1_000, retryAfterMs ?? RATE_LIMIT_BACKOFF_MS),
        );
        backoffUntil.set(key, now + forMs);
      }
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
      accountOpenUntil.delete(code);
      const key = keyOf(code, model);
      backoffUntil.delete(key);
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
