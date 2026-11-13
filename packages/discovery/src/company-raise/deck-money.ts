/**
 * The money a deck's raise states, read from the deck's own amount text
 * ("₦1.2bn", "NGN 1,200,000,000", "$1.8M", "US$ 500k") for the raise
 * policy's DECK_CLAIM (2026-11-13).
 *
 * Deterministic and strict on purpose: the whole text must be ONE amount
 * with ONE currency, or the answer is null (no claim, the raise stays
 * unknown). A range ("$1-2M"), a figure without a currency, two figures,
 * prose, or a currency sign that names more than one currency are never
 * guessed at. Currencies are never converted; the amount is a decimal
 * string, never a float.
 */

export type DeckMoney = { readonly amount: string; readonly currency: string };

/** Signs and codes written before the figure, lower-cased. */
const LEADING: Readonly<Record<string, string>> = {
  us$: "USD",
  $: "USD",
  usd: "USD",
  "₦": "NGN",
  ngn: "NGN",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  ksh: "KES",
  kes: "KES",
  zar: "ZAR",
  // "R10m": the rand, only as a capital R directly before the figure.
  r: "ZAR",
};

/** Codes and words written after the figure, lower-cased. */
const TRAILING: Readonly<Record<string, string>> = {
  usd: "USD",
  "us dollars": "USD",
  dollars: "USD",
  ngn: "NGN",
  naira: "NGN",
  eur: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pounds: "GBP",
  kes: "KES",
  zar: "ZAR",
  rand: "ZAR",
};

const SCALES: Readonly<Record<string, number>> = {
  k: 3,
  thousand: 3,
  m: 6,
  mm: 6,
  mn: 6,
  million: 6,
  b: 9,
  bn: 9,
  billion: 9,
};

const AMOUNT = new RegExp(
  String.raw`^(?:(us\$|\$|₦|€|£|ksh|usd|ngn|eur|gbp|kes|zar|r(?=\s?\d))\s?)?` +
    String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)` +
    String.raw`\s?(thousand|million|billion|mm|mn|bn|k|m|b)?` +
    String.raw`(?:\s+(us dollars|dollars|usd|ngn|naira|eur|euros|gbp|pounds|kes|zar|rand))?$`,
  "iu",
);

/** "1.2" scaled by 10^exponent, as a decimal string; never a float. */
function scaled(number: string, exponent: number): string {
  const [whole = "0", fraction = ""] = number.replace(/,/gu, "").split(".");
  const point = whole.length + exponent;
  const digits = (whole + fraction).padEnd(point, "0");
  const integer = digits.slice(0, point).replace(/^0+/u, "") || "0";
  const rest = digits.slice(point).replace(/0+$/u, "");
  return rest === "" ? integer : `${integer}.${rest}`;
}

export function deckMoneyFrom(
  text: string | null | undefined,
): DeckMoney | null {
  if (typeof text !== "string") return null;
  const flat = text.replace(/\s+/gu, " ").trim().replace(/[.;]$/u, "");
  if (flat.length === 0 || flat.length > 40) return null;
  const match = AMOUNT.exec(flat);
  if (match === null) return null;
  const [, lead, number, scale, trail] = match;
  if (number === undefined) return null;
  // The rand's sign only as written: a lower-case "r" is not a currency.
  if (lead !== undefined && lead.toLowerCase() === "r" && lead !== "R") {
    return null;
  }
  const before = lead === undefined ? undefined : LEADING[lead.toLowerCase()];
  const after = trail === undefined ? undefined : TRAILING[trail.toLowerCase()];
  // Exactly one currency, or two that agree ("$500k USD"); else unknown.
  if (before === undefined && after === undefined) return null;
  if (before !== undefined && after !== undefined && before !== after) {
    return null;
  }
  const currency = before ?? after;
  if (currency === undefined) return null;
  const amount = scaled(
    number,
    scale === undefined ? 0 : (SCALES[scale.toLowerCase()] ?? 0),
  );
  // Zero is not a raise; unknown stays unknown.
  if (!/[1-9]/u.test(amount)) return null;
  return { amount, currency };
}
