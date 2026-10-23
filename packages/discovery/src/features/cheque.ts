/**
 * `cheque-fit.v1` (owner 23 Oct 2026): does the investor's declared cheque
 * range fit the round the company has shared with them?
 *
 * The round is the company's current raise target, read only where the
 * company lets this investor see it (its Q Card's `currentRaise` scope, or
 * a disclosure of the capital objective to this investor organisation).
 * The range is the investor's own ACTIVE mandate. Both are exact decimal
 * strings in an ISO currency; arithmetic is on scaled integers, never
 * floats, and nothing is converted between currencies: a mismatch, an
 * unshared round or an undeclared range stays unknown and never counts
 * against the company.
 *
 * The outcome is a category, so an explanation can say which side of the
 * range the round falls without ever naming an amount:
 *
 *   WITHIN_ROUND        every cheque in the range fits inside the round
 *   PARTLY_WITHIN_ROUND the low end fits, the declared top end is larger
 *   ABOVE_ROUND         the smallest cheque is larger than the whole round
 *
 * Pure: no clock, no query, no model.
 */

export const CHEQUE_FIT_POLICY_VERSION = "cheque-fit.v1" as const;

export const CHEQUE_FIT_CATEGORIES = [
  "WITHIN_ROUND",
  "PARTLY_WITHIN_ROUND",
  "ABOVE_ROUND",
] as const;
export type ChequeFitCategory = (typeof CHEQUE_FIT_CATEGORIES)[number];

export type DeclaredChequeRange = {
  readonly currency: string;
  readonly min?: string | undefined;
  readonly max?: string | undefined;
};

export type SharedRoundTarget = {
  readonly amount: string;
  readonly currency: string;
};

export type ChequeFit =
  | { readonly kind: "FIT"; readonly category: ChequeFitCategory }
  /** No range declared (or only a currency): nothing to compare. */
  | { readonly kind: "NO_RANGE" }
  /** The company has not shared a round with this investor. */
  | { readonly kind: "ROUND_NOT_SHARED" }
  /** Different currencies: never converted, never guessed. */
  | { readonly kind: "CURRENCY_MISMATCH" };

const SCALE_DIGITS = 6;
const DECIMAL = /^(\d{1,18})(?:\.(\d{1,12}))?$/;
const CURRENCY = /^[A-Z]{3}$/;

/** An exact non-negative decimal string, scaled to integer micro-units; or null. */
export function scaled(amount: string): bigint | null {
  const match = DECIMAL.exec(amount.trim());
  if (match === null) return null;
  const whole = match[1] ?? "0";
  // Truncation below a micro-unit cannot change which side of a bound an
  // amount falls on for any real cheque or round.
  const fraction = (match[2] ?? "")
    .padEnd(SCALE_DIGITS, "0")
    .slice(0, SCALE_DIGITS);
  return BigInt(whole) * 10n ** BigInt(SCALE_DIGITS) + BigInt(fraction);
}

export function chequeFit(
  range: DeclaredChequeRange | null | undefined,
  round: SharedRoundTarget | null | undefined,
): ChequeFit {
  if (range === null || range === undefined) return { kind: "NO_RANGE" };
  const min = range.min === undefined ? null : scaled(range.min);
  const max = range.max === undefined ? null : scaled(range.max);
  if (min === null && max === null) return { kind: "NO_RANGE" };
  if (round === null || round === undefined)
    return { kind: "ROUND_NOT_SHARED" };
  const target = scaled(round.amount);
  if (target === null || target <= 0n) return { kind: "ROUND_NOT_SHARED" };
  const own = range.currency.trim().toUpperCase();
  const theirs = round.currency.trim().toUpperCase();
  if (!CURRENCY.test(own) || !CURRENCY.test(theirs) || own !== theirs) {
    return { kind: "CURRENCY_MISMATCH" };
  }
  const low = min ?? 0n;
  if (low > target) return { kind: "FIT", category: "ABOVE_ROUND" };
  // An open top end sets no ceiling to exceed: the low end decides.
  if (max !== null && max > target) {
    return { kind: "FIT", category: "PARTLY_WITHIN_ROUND" };
  }
  return { kind: "FIT", category: "WITHIN_ROUND" };
}
