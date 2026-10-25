import {
  ECB_SOURCE,
  MARKET_SOURCE,
  type FxRateProvider,
  type FxRateSource,
  type FxReferenceRateStore,
  type FxReferenceRates,
} from "./ecb.js";

/**
 * Owner 23 Oct 2026: "if you don't know something, go to the internet and
 * find it." Exchange rates are public; a cheque comparison across
 * currencies never stops at "no rate stored".
 *
 * For each source, preferred first (the ECB's reference rates, then the
 * public market feed for currencies the ECB does not publish): the latest
 * stored set. A stale one is still used at once (its date is said beside
 * the estimate) and refreshed from the internet behind it, stored for
 * everyone after; only when nothing is stored is it fetched now.
 */

/** How old a stored set may be before it is fetched again. */
export const FX_MAX_AGE_DAYS: Readonly<Record<FxRateSource, number>> = {
  // Published each TARGET working day: a long weekend is four days.
  [ECB_SOURCE]: 4,
  [MARKET_SOURCE]: 2,
};

export type LiveFxRates = {
  /** Current rate sets, preferred source first; empty only if every source failed. */
  readonly current: () => Promise<readonly FxReferenceRates[]>;
};

function ageInDays(rateDate: string, now: Date): number {
  const then = Date.parse(`${rateDate}T00:00:00Z`);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

export function createLiveFxRates(dependencies: {
  readonly store: FxReferenceRateStore;
  /** In preference order. */
  readonly providers: readonly {
    readonly source: FxRateSource;
    readonly provider: FxRateProvider;
  }[];
  readonly now?: (() => Date) | undefined;
}): LiveFxRates {
  const now = dependencies.now ?? (() => new Date());
  /** One fetch per source at a time, however many answers ask. */
  const refreshing = new Map<FxRateSource, Promise<FxReferenceRates | null>>();
  const refresh = (entry: {
    readonly source: FxRateSource;
    readonly provider: FxRateProvider;
  }): Promise<FxReferenceRates | null> => {
    const running = refreshing.get(entry.source);
    if (running !== undefined) return running;
    const work = (async () => {
      const fetched = await entry.provider.fetchDaily().catch(() => null);
      if (fetched !== null) {
        await dependencies.store.record(fetched).catch(() => 0);
      }
      return fetched;
    })().finally(() => refreshing.delete(entry.source));
    refreshing.set(entry.source, work);
    return work;
  };
  const one = async (entry: {
    readonly source: FxRateSource;
    readonly provider: FxRateProvider;
  }): Promise<FxReferenceRates | null> => {
    const stored = await dependencies.store
      .latest(entry.source)
      .catch(() => null);
    if (stored === null) {
      // Nothing stored at all: go and get it now (bounded by its timeout).
      return refresh(entry);
    }
    if (ageInDays(stored.rateDate, now()) > FX_MAX_AGE_DAYS[entry.source]) {
      // Owner 2026-10-25 (discover 17–20 s on some calls): a stale set is
      // used at once, its date said beside the estimate, and refreshed
      // behind it; an answer never waits on the internet for a rate it
      // already holds.
      void refresh(entry);
    }
    return stored;
  };
  return {
    current: async () =>
      (await Promise.all(dependencies.providers.map(one))).filter(
        (rates): rates is FxReferenceRates => rates !== null,
      ),
  };
}
