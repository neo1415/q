import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createEcbFxRateProvider,
  createPostgresFxReferenceRates,
  estimateInCurrency,
  parseEcbDaily,
} from "../src/fx/ecb.js";

/**
 * Owner 23 Oct 2026: ECB daily euro reference rates, fetched by a worker
 * and stored as dated reference data; a conversion is an estimate.
 */

const DAILY = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-10-23'>
      <Cube currency='USD' rate='1.0812'/>
      <Cube currency='GBP' rate='0.86125'/>
      <Cube currency='JPY' rate='162.45'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("ECB daily reference rates", () => {
  it("reads the dated cube exactly as published", () => {
    const rates = parseEcbDaily(DAILY);
    expect(rates?.rateDate).toBe("2026-10-23");
    expect(rates?.perEuro.get("GBP")).toBe("0.86125");
    expect(rates?.perEuro.size).toBe(3);
  });

  it("refuses a malformed file whole rather than storing part of it", () => {
    expect(parseEcbDaily("<html>maintenance</html>")).toBeNull();
    expect(
      parseEcbDaily(DAILY.replace("rate='1.0812'", "rate='1.0.8'")),
    ).toBeNull();
    expect(
      parseEcbDaily(DAILY.replace("currency='USD'", "currency='usd'")),
    ).toBeNull();
  });

  it("converts through the euro with exact decimals, rounded to cents", () => {
    const rates = parseEcbDaily(DAILY);
    if (rates === null) throw new Error("parse");
    // £3,000,000 / 0.86125 per EUR = €3,483,309.14
    expect(estimateInCurrency("3000000", "GBP", "EUR", rates)).toBe(
      "3483309.14",
    );
    // via the euro: £3,000,000 -> USD at 1.0812 / 0.86125
    expect(estimateInCurrency("3000000", "GBP", "USD", rates)).toBe(
      "3766153.85",
    );
    expect(estimateInCurrency("1000000", "EUR", "USD", rates)).toBe("1081200");
    expect(estimateInCurrency("1000", "GBP", "CHF", rates)).toBeNull();
    expect(estimateInCurrency("1e6", "GBP", "EUR", rates)).toBeNull();
  });

  it("the provider adapter is one GET of the public file; a failure stores nothing", async () => {
    const asked: string[] = [];
    const ok = createEcbFxRateProvider({
      fetch: (url) => {
        asked.push(
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        );
        return Promise.resolve(new Response(DAILY, { status: 200 }));
      },
    });
    expect((await ok.fetchDaily())?.rateDate).toBe("2026-10-23");
    expect(asked).toEqual([
      "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    ]);
    const down = createEcbFxRateProvider({
      fetch: () => Promise.resolve(new Response("", { status: 503 })),
    });
    expect(await down.fetchDaily()).toBeNull();
  });

  it("the store appends a dated, versioned set and reads the latest date back", async () => {
    const calls: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return Promise.resolve(
        strings.join("?").includes("insert into")
          ? [{ id: "a" }, { id: "b" }, { id: "c" }]
          : [
              {
                rate_date: "2026-10-23",
                quote_currency: "GBP",
                rate: "0.8612500000",
              },
              {
                rate_date: "2026-10-23",
                quote_currency: "USD",
                rate: "1.0812000000",
              },
            ],
      );
    }) as unknown as DatabaseExecutor;
    const store = createPostgresFxReferenceRates({ sql });
    const rates = parseEcbDaily(DAILY);
    if (rates === null) throw new Error("parse");
    expect(await store.record(rates)).toBe(3);
    expect(calls[0]).toEqual([
      "ECB_EUROFXREF",
      "eurofxref-daily.v1",
      "2026-10-23",
      ["USD", "GBP", "JPY"],
      ["1.0812", "0.86125", "162.45"],
    ]);
    const latest = await store.latest();
    expect(latest?.rateDate).toBe("2026-10-23");
    expect(latest?.perEuro.get("USD")).toBe("1.0812000000");
  });
});
