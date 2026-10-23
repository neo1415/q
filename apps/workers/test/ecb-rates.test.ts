import { describe, expect, it } from "vitest";

import { refreshEcbRates, runEcbRatesTicker } from "../src/fx/ecb-rates.js";

/** Owner 23 Oct 2026: the ECB rates are fetched here, and only here. */

const rates = {
  source: "ECB_EUROFXREF" as const,
  rateDate: "2026-10-23",
  perEuro: new Map([["GBP", "0.86125"]]),
};

describe("ECB reference rates in the worker", () => {
  it("stores a fetched set, and a failed fetch stores nothing", async () => {
    const recorded: unknown[] = [];
    const store = {
      latest: () => Promise.resolve(null),
      record: (r: unknown) => {
        recorded.push(r);
        return Promise.resolve(1);
      },
    };
    expect(
      await refreshEcbRates({
        provider: { fetchDaily: () => Promise.resolve(rates) },
        store,
      }),
    ).toEqual({ rateDate: "2026-10-23", stored: 1 });
    expect(
      await refreshEcbRates({
        provider: { fetchDaily: () => Promise.resolve(null) },
        store,
      }),
    ).toEqual({ rateDate: null, stored: 0 });
    expect(recorded).toEqual([rates]);
  });

  it("a fetch that throws never stops the ticker", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const warnings: string[] = [];
    await runEcbRatesTicker({
      provider: {
        fetchDaily: () => {
          attempts += 1;
          return Promise.reject(new Error("network"));
        },
      },
      store: {
        latest: () => Promise.resolve(null),
        record: () => Promise.resolve(0),
      },
      signal: controller.signal,
      logger: {
        info: () => undefined,
        warn: (_o: unknown, m: string) => warnings.push(m),
        error: () => undefined,
      },
      sleep: () => {
        if (attempts >= 2) controller.abort();
        return Promise.resolve();
      },
    });
    expect(attempts).toBe(2);
    expect(warnings).toHaveLength(2);
  });
});
