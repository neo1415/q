import {
  isResearchProviderFailure,
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";

/**
 * A circuit breaker on one research provider, for the whole process
 * (production 2026-10-25: every index's key was refused or spent -- Tavily
 * 432, Serper and Brave 402, ScrapingBee 401 -- and each was still called
 * ~12 times a turn, 60 refusals per provider in 30 minutes). A refused or
 * spent key will not come back by itself: the provider is not called again
 * for a cool-off window, and that is logged once, when it trips. A rate
 * limit rests it for a minute. While open, a call fails at once, with the
 * failure that opened it, and costs nothing.
 *
 * Wrapped once around each configured index, so every consumer (the merged
 * search, the person lane, briefs, discovery) shares the one breaker.
 */

/** How long a refused or spent key rests; a rate limit rests a minute. */
export const BREAKER_COOL_OFF_MS = { SPENT: 15 * 60_000, RATE_LIMIT: 60_000 };

/** The vendor statuses that say the key is refused or its credit spent. */
const SPENT_STATUSES = new Set([401, 402, 403, 432, 433]);

/** A call the breaker refused without asking the provider. */
export class ResearchProviderResting extends ResearchProviderFailure {
  readonly resting = true;
}

export function isResting(error: unknown): error is ResearchProviderResting {
  return error instanceof ResearchProviderResting;
}

export type BreakerTrip = {
  readonly provider: string;
  readonly status: number | null;
  readonly failureClass: string;
  readonly coolOffMs: number;
};

/**
 * One breaker, for one credential: several providers on the same key (the
 * SERP key's web and image searches; Brave's) share it, so a spent key
 * rests everywhere it is used (coordinator 2026-10-25).
 */
export type CircuitBreaker = {
  readonly guard: <T>(code: string, call: () => Promise<T>) => Promise<T>;
};

export function createCircuitBreaker(
  options: {
    readonly now?: (() => number) | undefined;
    /** Called once each time the breaker opens. */
    readonly onTrip?: ((trip: BreakerTrip) => void) | undefined;
  } = {},
): CircuitBreaker {
  const now = options.now ?? Date.now;
  let openUntil = 0;
  let opened: ResearchProviderFailure | null = null;

  const coolOffFor = (error: ResearchProviderFailure): number | null =>
    (error.status !== null && SPENT_STATUSES.has(error.status)) ||
    error.failureClass === "AUTHENTICATION"
      ? BREAKER_COOL_OFF_MS.SPENT
      : error.failureClass === "RATE_LIMIT" || error.status === 429
        ? BREAKER_COOL_OFF_MS.RATE_LIMIT
        : null;

  return {
    guard: async (code, call) => {
      if (opened !== null && now() < openUntil) {
        throw new ResearchProviderResting({
          providerCode: code as ResearchProviderFailure["providerCode"],
          failureClass: opened.failureClass,
          status: opened.status,
        });
      }
      try {
        const result = await call();
        opened = null;
        return result;
      } catch (error: unknown) {
        if (isResearchProviderFailure(error)) {
          const coolOffMs = coolOffFor(error);
          if (coolOffMs !== null) {
            // Calls in flight together fail together: logged once.
            const already = opened !== null && now() < openUntil;
            opened = error;
            openUntil = now() + coolOffMs;
            if (!already) {
              options.onTrip?.({
                provider: code,
                status: error.status,
                failureClass: error.failureClass,
                coolOffMs,
              });
            }
          }
        }
        throw error;
      }
    },
  };
}

export function withCircuitBreaker(
  provider: PublicWebResearchProvider,
  options: {
    readonly now?: (() => number) | undefined;
    /** Called once each time the breaker opens. */
    readonly onTrip?: ((trip: BreakerTrip) => void) | undefined;
    /** The credential's breaker, when another provider shares the key. */
    readonly breaker?: CircuitBreaker | undefined;
  } = {},
): PublicWebResearchProvider {
  const breaker = options.breaker ?? createCircuitBreaker(options);
  return {
    get code() {
      return provider.code;
    },
    search: (request, context) =>
      breaker.guard(provider.code, () => provider.search(request, context)),
    extract: (request, context) =>
      breaker.guard(provider.code, () => provider.extract(request, context)),
    ...(provider.canSearch === false ? { canSearch: false as const } : {}),
    ...(provider.canReadPages === false
      ? { canReadPages: false as const }
      : {}),
  };
}
