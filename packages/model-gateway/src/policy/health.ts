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
 * skipped, every model on it, for this long after one such answer. Live
 * 2026-10-01: OpenAI credit ran out and every turn first spent two retries
 * on it before falling back.
 */
const ACCOUNT_EXHAUSTED_OPEN_MS = 10 * 60_000;

/**
 * While an account or key block is open, ONE real request is let through
 * this often to see whether a person has fixed it. Live 2026-10-31: the
 * owner topped up OpenAI credit, and every turn for the rest of the ten
 * minutes still had no route and was told to send it again. An exhausted
 * account answers 402 at once, so a probe costs one fast refusal a
 * half-minute, never a retry and never one per concurrent turn
 * (`admit`); a probe that succeeds clears the block (`recordSuccess`).
 */
const BLOCKED_PROBE_INTERVAL_MS = 30_000;

/**
 * Round 8 (hosted Gemini 402, 2026-10-21): a 429 backs that one model off
 * at once, for the provider's Retry-After or this long, bounded; during it
 * the model is tried only when no other eligible model is left.
 */
const RATE_LIMIT_BACKOFF_MS = 15_000;

/**
 * An attempt that ended in one of these got an answer from the provider's
 * account: the request was billed-for or judged on its merits, so the
 * account and the key are serving again. Live 2026-11-05: a probe needs
 * only proof that the account answers, not a perfect reply.
 */
const ACCOUNT_ANSWERED: ReadonlySet<ModelFailureClass> = new Set([
  "INVALID_MODEL_OUTPUT",
  "INVALID_REQUEST",
  "CONTEXT_LIMIT",
  "RATE_LIMIT",
]);
const RATE_LIMIT_BACKOFF_MAX_MS = 60_000;

export type ProviderHealthOptions = {
  readonly failureThreshold?: number | undefined;
  readonly windowMs?: number | undefined;
  readonly openForMs?: number | undefined;
  readonly accountExhaustedOpenForMs?: number | undefined;
  /** How often a blocked account or key is probed by one real request. */
  readonly blockedProbeIntervalMs?: number | undefined;
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
  const probeEveryMs =
    options.blockedProbeIntervalMs ?? BLOCKED_PROBE_INTERVAL_MS;
  /** Provider-wide: every model on an exhausted account. */
  const accountOpenUntil = new Map<ModelProviderCode, number>();
  /** One model whose key the provider refused (401/403). */
  const refusedUntil = new Map<string, number>();
  /**
   * When each open block (provider for an account, provider+model for a
   * refused key) last let a request through, or opened. A probe is due
   * once this is `probeEveryMs` old.
   */
  const lastProbe = new Map<string, number>();
  /** One model, after a 429: tried only as the last resort until then. */
  const backoffUntil = new Map<string, number>();
  /**
   * The probe each open block has in flight, with the waiters for its
   * verdict. Live 2026-11-05: one turn asks several models at once (skim,
   * early reading, reading, speculation). Only one could be the probe; the
   * others were turned away at once, the turn said "I can't reach my
   * reasoning service", and the probe's own request was then cancelled
   * with the turn, so no verdict ever arrived and every later turn met the
   * same block until it lapsed ten minutes after the last refusal.
   */
  const inFlight = new Map<
    string,
    { readonly settled: Promise<void>; readonly settle: () => void }
  >();
  const settle = (key: string): void => {
    const probe = inFlight.get(key);
    if (probe === undefined) return;
    inFlight.delete(key);
    probe.settle();
  };
  /** Every probe this model's attempt could have been. */
  const settleFor = (code: ModelProviderCode, model: ModelCode): void => {
    settle(accountKey(code));
    settle(keyOf(code, model));
  };
  /**
   * The probe ended without a verdict (cancelled, or the caller's own short
   * budget ran out, or it was never sent): the next request may probe at
   * once rather than a whole interval later.
   */
  const release = (code: ModelProviderCode, model: ModelCode): void => {
    for (const key of [accountKey(code), keyOf(code, model)]) {
      if (!inFlight.has(key)) continue;
      lastProbe.delete(key);
      settle(key);
    }
  };
  /** The account and this model's key answered: every block on them ends. */
  const clearBlocks = (code: ModelProviderCode, model: ModelCode): void => {
    accountOpenUntil.delete(code);
    lastProbe.delete(accountKey(code));
    const key = keyOf(code, model);
    refusedUntil.delete(key);
    lastProbe.delete(key);
    settleFor(code, model);
  };

  const keyOf = (code: ModelProviderCode, model: ModelCode): string =>
    `${code}\u0000${model}`;
  const accountKey = (code: ModelProviderCode): string => `${code}\u0000*`;

  /**
   * The block a request to this model meets, if any: its key, and whether
   * a probe of it is due. The account block is checked first because it
   * covers every model on the provider.
   */
  const blockOf = (
    code: ModelProviderCode,
    model: ModelCode,
    now: number,
  ): { readonly key: string; readonly probeDue: boolean } | null => {
    const due = (key: string) =>
      now - (lastProbe.get(key) ?? 0) >= probeEveryMs;
    const accountUntil = accountOpenUntil.get(code);
    if (accountUntil !== undefined && accountUntil > now) {
      const key = accountKey(code);
      return { key, probeDue: due(key) };
    }
    const key = keyOf(code, model);
    const refused = refusedUntil.get(key);
    if (refused !== undefined && refused > now) {
      return { key, probeDue: due(key) };
    }
    return null;
  };

  const state = (
    code: ModelProviderCode,
    model: ModelCode,
    at: Date,
  ): ProviderHealthState => {
    const until = openUntil.get(keyOf(code, model));
    if (until !== undefined && until > at.getTime()) {
      return "TEMPORARILY_FAILING";
    }
    // A block whose probe is due, or in flight, reads healthy, so the model
    // is planned in its usual place; `admit` lets only one request actually
    // ask and the others wait for its verdict.
    const block = blockOf(code, model, at.getTime());
    if (block !== null && !block.probeDue && !inFlight.has(block.key)) {
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
    admit: (code, model, at) => {
      const now = at.getTime();
      const block = blockOf(code, model, now);
      if (block === null) return true;
      if (!block.probeDue) return false;
      // Claimed here, synchronously, so concurrent turns that planned the
      // same due probe do not all send it.
      lastProbe.set(block.key, now);
      settle(block.key);
      let resolve: () => void = () => undefined;
      const settled = new Promise<void>((done) => {
        resolve = done;
      });
      inFlight.set(block.key, { settled, settle: resolve });
      return true;
    },
    probeInFlight: (code, model, at) => {
      const block = blockOf(code, model, at.getTime());
      if (block === null) return null;
      return inFlight.get(block.key)?.settled ?? null;
    },
    releaseProbe: release,
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
        lastProbe.set(accountKey(code), now);
        settleFor(code, model);
        return;
      }
      // A key the provider refused (401/403, after the adapter tried its
      // other keys) does not heal either; only this model is skipped, as a
      // refusal can be one model's (not enabled for the key).
      if (failureClass === "AUTHENTICATION") {
        const key = keyOf(code, model);
        refusedUntil.set(key, now + accountOpenForMs);
        lastProbe.set(key, now);
        settleFor(code, model);
        return;
      }
      // The account answered (a reply that failed our checks, a request it
      // judged, a per-minute limit that is not a spent quota): any block on
      // it was fixed. A probe proves the account, not the reply.
      if (ACCOUNT_ANSWERED.has(failureClass)) {
        clearBlocks(code, model);
      }
      // No verdict about the account: stopped by the caller, or the
      // caller's own short budget ran out first.
      if (
        failureClass === "CANCELLED" ||
        (failureClass === "TIMEOUT" &&
          elapsedMs !== undefined &&
          elapsedMs < TIMEOUT_MEANS_UNHEALTHY_AFTER_MS)
      ) {
        release(code, model);
      } else {
        // An outage or transient answer is the probe's verdict: the block
        // stays and the next probe waits its interval.
        settleFor(code, model);
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
      clearBlocks(code, model);
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
  admit: () => true,
  recordFailure: () => undefined,
  recordSuccess: () => undefined,
};
