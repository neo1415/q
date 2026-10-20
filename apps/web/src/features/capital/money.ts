import { formatAmountForDisplay } from "@capital-q/ui/money-input";

/**
 * Money on the Capital page: exact decimal strings, grouped for reading.
 * Shares of a target are computed in integer minor units (amounts carry at
 * most two decimals), never through a float.
 */

export function money(amount: string, currency: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const cents =
    fraction === undefined || /^0*$/.test(fraction)
      ? ""
      : `.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return `${currency} ${formatAmountForDisplay(whole)}${cents}`;
}

export function figure(amount: string): string {
  return money(amount, "").trim();
}

function minor(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * 100n +
    BigInt(fraction.padEnd(2, "0").slice(0, 2) || "0")
  );
}

/** Basis points (0..10000) of `part` in `whole`, capped at the whole. */
export function shareOf(part: string, whole: string): number {
  const of = minor(whole);
  if (of <= 0n) return 0;
  const bp = (minor(part) * 10000n) / of;
  return Number(bp > 10000n ? 10000n : bp);
}

/** Whole percent for words: "17%". */
export function percent(basisPoints: number): string {
  return `${String(Math.floor(basisPoints / 100))}%`;
}

/** Minor units back to an exact decimal string: 12345n -> "123.45". */
function fromMinor(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const text =
    cents === 0n
      ? whole.toString()
      : `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** `a - b`, exactly, never below zero (a share is never negative). */
export function minus(a: string, b: string): string {
  const out = minor(a) - minor(b);
  return fromMinor(out < 0n ? 0n : out);
}

/**
 * Sums kept apart by currency, in the order each currency first appears:
 * money in different currencies is never added or converted.
 */
export function totalsByCurrency(
  amounts: readonly { readonly amount: string; readonly currency: string }[],
): readonly { readonly amount: string; readonly currency: string }[] {
  const sums = new Map<string, bigint>();
  for (const { amount, currency } of amounts) {
    sums.set(currency, (sums.get(currency) ?? 0n) + minor(amount));
  }
  return [...sums].map(([currency, value]) => ({
    currency,
    amount: fromMinor(value),
  }));
}

/** "USD 250,000 and EUR 400,000": each currency on its own. */
export function moneyList(
  totals: readonly { readonly amount: string; readonly currency: string }[],
): string {
  const parts = totals.map((total) => money(total.amount, total.currency));
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** Whether an exact decimal string is zero. */
export function isZero(amount: string): boolean {
  return minor(amount) === 0n;
}
