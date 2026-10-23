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
 * stored set while it is current; otherwise fetched from the internet now,
 * stored for everyone after, and used. A fetch that fails falls back to the
 * last stored set, however old (its date is said beside the estimate).
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
  const one = async (entry: {
    readonly source: FxRateSource;
    readonly provider: FxRateProvider;
  }): Promise<FxReferenceRates | null> => {
    const stored = await dependencies.store
      .latest(entry.source)
      .catch(() => null);
    if (
      stored !== null &&
      ageInDays(stored.rateDate, now()) <= FX_MAX_AGE_DAYS[entry.source]
    ) {
      return stored;
    }
    // Not stored, or stale: go and get it.
    const fetched = await entry.provider.fetchDaily().catch(() => null);
    if (fetched === null) return stored;
    await dependencies.store.record(fetched).catch(() => 0);
    return fetched;
  };
  return {
    current: async () =>
      (await Promise.all(dependencies.providers.map(one))).filter(
        (rates): rates is FxReferenceRates => rates !== null,
      ),
  };
}
