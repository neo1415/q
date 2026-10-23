import type {
  FxRateProvider,
  FxReferenceRateStore,
} from "@capital-q/discovery";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Owner 23 Oct 2026: the ECB's daily euro reference rates, fetched here and
 * stored as dated reference data (recommendation.fx_reference_rates), so a
 * cheque in one currency can be compared with a round in another as an
 * ESTIMATE. The only place the provider is called: no request ever does.
 *
 * The ECB publishes once each TARGET working day around 16:00 CET; four
 * looks a day find each set within hours. A set already stored for its
 * date is a no-op; a failed fetch stores nothing and keeps the last set.
 */

export const ECB_RATES_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function refreshEcbRates(options: {
  readonly provider: FxRateProvider;
  readonly store: FxReferenceRateStore;
}): Promise<{ readonly rateDate: string | null; readonly stored: number }> {
  const rates = await options.provider.fetchDaily();
  if (rates === null) return { rateDate: null, stored: 0 };
  return {
    rateDate: rates.rateDate,
    stored: await options.store.record(rates),
  };
}

export async function runEcbRatesTicker(options: {
  readonly provider: FxRateProvider;
  readonly store: FxReferenceRateStore;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  while (!options.signal.aborted) {
    try {
      const result = await refreshEcbRates(options);
      if (result.rateDate === null) {
        options.logger.warn(
          {},
          "exchange rates unavailable; keeping the last stored set",
        );
      } else if (result.stored > 0) {
        options.logger.info({ ...result }, "exchange rates stored");
      }
    } catch {
      options.logger.warn(
        {},
        "exchange rates fetch failed; retrying next interval",
      );
    }
    await sleep(options.intervalMs ?? ECB_RATES_INTERVAL_MS, options.signal);
  }
}
