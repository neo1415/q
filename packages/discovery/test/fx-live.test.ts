import { describe, expect, it } from "vitest";

import { parseMarketLatest, type FxReferenceRates } from "../src/fx/ecb.js";
import { createLiveFxRates } from "../src/fx/live.js";

/**
 * Owner 23 Oct 2026: "if you don't know something, go to the internet and
 * find it." No stored rate is never the end of a cheque comparison.
 */

const ecb = (rateDate: string): FxReferenceRates => ({
  source: "ECB_EUROFXREF",
  rateDate,
  perEuro: new Map([["GBP", "0.86"]]),
});
const market = (rateDate: string): FxReferenceRates => ({
  source: "EXCHANGERATE_API_OPEN",
  rateDate,
  perEuro: new Map([["NGN", "1497.107782"]]),
});
const NOW = new Date("2026-10-23T15:00:00Z");

function storeWith(stored: Partial<Record<string, FxReferenceRates>>) {
  const recorded: FxReferenceRates[] = [];
  return {
    recorded,
    store: {
      latest: (source?: string) =>
        Promise.resolve(stored[source ?? "ECB_EUROFXREF"] ?? null),
      record: (rates: FxReferenceRates) => {
        recorded.push(rates);
        return Promise.resolve(rates.perEuro.size);
      },
    },
  };
}

describe("exchange rates, found when not stored", () => {
  it("nothing stored: fetched from the internet now, stored, and used", async () => {
    const { store, recorded } = storeWith({});
    let fetched = 0;
    const live = createLiveFxRates({
      store,
      providers: [
        {
          source: "ECB_EUROFXREF",
          provider: {
            fetchDaily: () => {
              fetched += 1;
              return Promise.resolve(ecb("2026-10-23"));
            },
          },
        },
        {
          source: "EXCHANGERATE_API_OPEN",
          provider: { fetchDaily: () => Promise.resolve(market("2026-10-23")) },
        },
      ],
      now: () => NOW,
    });
    const sets = await live.current();
    expect(sets.map((s) => s.source)).toEqual([
      "ECB_EUROFXREF",
      "EXCHANGERATE_API_OPEN",
    ]);
    expect(fetched).toBe(1);
    expect(recorded.map((r) => r.source)).toEqual([
      "ECB_EUROFXREF",
      "EXCHANGERATE_API_OPEN",
    ]);
  });

  it("a current stored set is used without going out", async () => {
    const { store, recorded } = storeWith({
      ECB_EUROFXREF: ecb("2026-10-22"),
      EXCHANGERATE_API_OPEN: market("2026-10-23"),
    });
    const never = {
      fetchDaily: () => Promise.reject(new Error("should not be called")),
    };
    const live = createLiveFxRates({
      store,
      providers: [
        { source: "ECB_EUROFXREF", provider: never },
        { source: "EXCHANGERATE_API_OPEN", provider: never },
      ],
      now: () => NOW,
    });
    expect((await live.current()).map((s) => s.rateDate)).toEqual([
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(recorded).toEqual([]);
  });

  it("a stale set is refreshed; if the internet is down the last stored set still serves, with its date", async () => {
    const { store } = storeWith({ ECB_EUROFXREF: ecb("2026-10-01") });
    const live = createLiveFxRates({
      store,
      providers: [
        {
          source: "ECB_EUROFXREF",
          provider: { fetchDaily: () => Promise.reject(new Error("offline")) },
        },
      ],
      now: () => NOW,
    });
    expect((await live.current())[0]?.rateDate).toBe("2026-10-01");
  });

  // Owner 2026-10-25 (discover 17–20 s on some calls): a stale set waited
  // on a 15 s internet fetch inside the network fit rank. An answer never
  // waits for the internet when a set is stored: the stored set serves at
  // once, and one refresh runs behind it.
  it("a stale set serves at once while one refresh runs in the background", async () => {
    const { store, recorded } = storeWith({ ECB_EUROFXREF: ecb("2026-10-01") });
    let fetches = 0;
    let land: (rates: FxReferenceRates) => void = () => undefined;
    const live = createLiveFxRates({
      store,
      providers: [
        {
          source: "ECB_EUROFXREF",
          provider: {
            fetchDaily: () => {
              fetches += 1;
              return new Promise<FxReferenceRates>((resolve) => {
                land = resolve;
              });
            },
          },
        },
      ],
      now: () => NOW,
    });
    const first = await live.current();
    const second = await live.current();
    expect(first[0]?.rateDate).toBe("2026-10-01");
    expect(second[0]?.rateDate).toBe("2026-10-01");
    // One refresh in flight, however many asks.
    expect(fetches).toBe(1);
    land(ecb("2026-10-23"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recorded.map((r) => r.rateDate)).toEqual(["2026-10-23"]);
  });

  it("reads the market feed strictly, base EUR, dated by its update time", () => {
    const rates = parseMarketLatest({
      result: "success",
      base_code: "EUR",
      time_last_update_unix: 1792713751,
      rates: { EUR: 1, NGN: 1497.107782, GBP: 0.837418, USD: 1.0812 },
    });
    expect(rates?.source).toBe("EXCHANGERATE_API_OPEN");
    expect(rates?.rateDate).toBe("2026-10-23");
    expect(rates?.perEuro.get("NGN")).toBe("1497.107782");
    expect(rates?.perEuro.has("EUR")).toBe(false);
    expect(
      parseMarketLatest({ result: "error", base_code: "EUR", rates: {} }),
    ).toBeNull();
    expect(
      parseMarketLatest({
        result: "success",
        base_code: "USD",
        time_last_update_unix: 1,
        rates: { NGN: 1 },
      }),
    ).toBeNull();
  });
});
