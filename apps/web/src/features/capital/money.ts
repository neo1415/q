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
