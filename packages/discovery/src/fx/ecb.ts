import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Owner 23 Oct 2026: the ECB's daily euro foreign exchange reference
 * rates, as dated reference data for ESTIMATE cross-currency cheque
 * comparisons ("approximately, at the ECB rate of 23 Oct 2026").
 *
 * Fetched once a day by a worker through the provider adapter below and
 * stored (recommendation.fx_reference_rates); no request ever calls the
 * provider. Rates are exact decimal strings, units of quote currency per
 * one euro, as published. A conversion is always an estimate: never
 * evidence, never verified, never used where both sides share a currency.
 */

export const ECB_SOURCE = "ECB_EUROFXREF" as const;
/** Which publication and parser produced the stored rows. */
export const ECB_SOURCE_VERSION = "eurofxref-daily.v1" as const;
export const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type FxReferenceRates = {
  readonly source: typeof ECB_SOURCE;
  /** ISO date (YYYY-MM-DD) the ECB set the rates for. */
  readonly rateDate: string;
  /** Units of quote currency per one euro, exact decimal strings; EUR is implied 1. */
  readonly perEuro: ReadonlyMap<string, string>;
};

const RATE = /^\d{1,10}(?:\.\d{1,10})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The ECB daily XML, read strictly: one dated cube of currency/rate pairs.
 * Anything malformed is refused whole rather than partly stored.
 */
export function parseEcbDaily(xml: string): FxReferenceRates | null {
  const dated = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/u.exec(xml);
  const rateDate = dated?.[1];
  if (rateDate === undefined || !DATE.test(rateDate)) return null;
  const perEuro = new Map<string, string>();
  const pair =
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/gu;
  for (const match of xml.matchAll(pair)) {
    const currency = match[1];
    const rate = match[2];
    if (currency === undefined || rate === undefined) return null;
    if (!CURRENCY.test(currency) || !RATE.test(rate) || currency === "EUR") {
      return null;
    }
    if (Number(rate) <= 0) return null;
    perEuro.set(currency, rate);
  }
  // Every currency entry must have parsed: a single malformed one refuses
  // the whole file rather than storing part of it.
  const entries = xml.match(/<Cube\s+currency=/gu)?.length ?? 0;
  if (perEuro.size === 0 || perEuro.size !== entries) return null;
  return { source: ECB_SOURCE, rateDate, perEuro };
}

// ---------------------------------------------------------------------------
// Exact decimal arithmetic for the estimate (no floats in the conversion).
// ---------------------------------------------------------------------------

const SCALE = 10n ** 18n;

function toScaled(value: string): bigint | null {
  const match = /^(\d{1,24})(?:\.(\d{1,18}))?$/u.exec(value.trim());
  if (match === null) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(18, "0").slice(0, 18));
  return whole * SCALE + fraction;
}

function fromScaled(value: bigint, places: number): string {
  const unit = 10n ** BigInt(18 - places);
  // Round half up at the requested places.
  const rounded = (value + unit / 2n) / unit;
  const text = rounded.toString().padStart(places + 1, "0");
  if (places === 0) return text;
  const whole = text.slice(0, -places);
  const fraction = text.slice(-places).replace(/0+$/u, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

/** Units of `currency` per one euro: EUR itself is 1. */
function perEuroOf(rates: FxReferenceRates, currency: string): bigint | null {
  if (currency === "EUR") return SCALE;
  const rate = rates.perEuro.get(currency);
  return rate === undefined ? null : toScaled(rate);
}

/**
 * `amount` in `from`, estimated in `to` through the euro at the stored
 * date's reference rates; null when either currency has no stored rate or
 * the amount is not an exact decimal. Rounded to two places.
 */
export function estimateInCurrency(
  amount: string,
  from: string,
  to: string,
  rates: FxReferenceRates,
): string | null {
  const value = toScaled(amount);
  const fromRate = perEuroOf(rates, from.toUpperCase());
  const toRate = perEuroOf(rates, to.toUpperCase());
  if (value === null || fromRate === null || toRate === null) return null;
  if (fromRate === 0n) return null;
  // value[from] / fromRate[from per EUR] * toRate[to per EUR]
  const converted = (value * toRate) / fromRate;
  return fromScaled(converted, 2);
}

// ---------------------------------------------------------------------------
// Storage and the provider adapter.
// ---------------------------------------------------------------------------

export type FxReferenceRateStore = {
  /** The most recent stored set from the ECB, or null when none is stored. */
  readonly latest: () => Promise<FxReferenceRates | null>;
  /** Append a published set; a set already stored for its date is a no-op. */
  readonly record: (rates: FxReferenceRates) => Promise<number>;
};

export function createPostgresFxReferenceRates(dependencies: {
  readonly sql: DatabaseExecutor;
}): FxReferenceRateStore {
  const { sql } = dependencies;
  return {
    latest: async () => {
      const rows = await sql<
        { rate_date: string; quote_currency: string; rate: string }[]
      >`
        select to_char(rate_date, 'YYYY-MM-DD') as rate_date,
               quote_currency, rate::text as rate
          from recommendation.fx_reference_rates
         where source = ${ECB_SOURCE}
           and rate_date = (select max(rate_date)
                              from recommendation.fx_reference_rates
                             where source = ${ECB_SOURCE})`;
      const first = rows[0];
      if (first === undefined) return null;
      return {
        source: ECB_SOURCE,
        rateDate: first.rate_date,
        perEuro: new Map(rows.map((row) => [row.quote_currency, row.rate])),
      };
    },
    record: async (rates) => {
      const entries = [...rates.perEuro.entries()];
      if (entries.length === 0) return 0;
      const inserted = await sql<{ id: string }[]>`
        insert into recommendation.fx_reference_rates
          (source, source_version, rate_date, base_currency, quote_currency, rate)
        select ${ECB_SOURCE}, ${ECB_SOURCE_VERSION}, ${rates.rateDate}::date,
               'EUR', quote, rate::numeric
          from unnest(${entries.map(([currency]) => currency)}::text[],
                      ${entries.map(([, rate]) => rate)}::text[]) as t(quote, rate)
        on conflict (source, source_version, rate_date, quote_currency) do nothing
        returning id`;
      return inserted.length;
    },
  };
}

/** The provider adapter: one GET of the ECB's public daily file. */
export type FxRateProvider = {
  readonly fetchDaily: () => Promise<FxReferenceRates | null>;
};

export function createEcbFxRateProvider(dependencies: {
  readonly fetch?: typeof fetch | undefined;
  readonly url?: string | undefined;
}): FxRateProvider {
  const doFetch = dependencies.fetch ?? fetch;
  return {
    fetchDaily: async () => {
      const response = await doFetch(dependencies.url ?? ECB_DAILY_URL, {
        headers: { accept: "application/xml" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const body = await response.text();
      // A daily file is a few kilobytes; anything far larger is not it.
      if (body.length > 200_000) return null;
      return parseEcbDaily(body);
    },
  };
}
