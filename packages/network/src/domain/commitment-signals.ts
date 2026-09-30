/**
 * Money Q heard in a call, turned into a commitment Q can file
 * (founder direction 2026-09-30).
 *
 * The input is Q's own structured record of the call (MEETING_NOTES
 * commitment signals), not a person's words, and this only reads the
 * amount it wrote down: a currency and a figure. Anything not written as
 * an exact figure with a known currency -- "half a million", "a few
 * hundred k", a bare "R" -- stays unknown and is not filed, rather than
 * guessed (unknown stays unknown).
 */

const SYMBOLS: readonly (readonly [string, string])[] = [
  ["US$", "USD"],
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₦", "NGN"],
  ["KSh", "KES"],
  ["GH₵", "GHS"],
];

const CODES = new Set([
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "ZAR",
  "GHS",
  "EGP",
  "MAD",
  "XOF",
  "RWF",
  "UGX",
  "TZS",
]);

const MULTIPLIERS: Readonly<Record<string, bigint>> = {
  "": 1n,
  k: 1_000n,
  thousand: 1_000n,
  m: 1_000_000n,
  mn: 1_000_000n,
  mm: 1_000_000n,
  million: 1_000_000n,
  b: 1_000_000_000n,
  bn: 1_000_000_000n,
  billion: 1_000_000_000n,
};

export type SpokenAmount = {
  /** Exact decimal string, at most two decimals. */
  readonly amount: string;
  readonly currencyCode: string;
};

/** Multiplies a decimal string by a whole multiplier, exactly. */
function scale(figure: string, multiplier: bigint): string | null {
  const [whole = "", fraction = ""] = figure.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  const digits = BigInt(whole + fraction) * multiplier;
  const places = BigInt(10) ** BigInt(fraction.length);
  const integer = digits / places;
  const remainder = digits % places;
  if (remainder === 0n) return integer.toString();
  // Keep at most two decimals; anything finer is not money we can file.
  const cents = (remainder * 100n) / places;
  if ((remainder * 100n) % places !== 0n) return null;
  return `${integer.toString()}.${cents.toString().padStart(2, "0")}`;
}

export function parseSpokenAmount(text: string): SpokenAmount | null {
  let rest = text.trim().replace(/\s+/g, " ");
  let currency: string | null = null;
  for (const [symbol, code] of SYMBOLS) {
    if (rest.startsWith(symbol)) {
      currency = code;
      rest = rest.slice(symbol.length).trim();
      break;
    }
  }
  const leadingCode = /^([A-Z]{3})\s*/.exec(rest);
  if (currency === null && leadingCode?.[1] !== undefined) {
    if (!CODES.has(leadingCode[1])) return null;
    currency = leadingCode[1];
    rest = rest.slice(leadingCode[0].length);
  }
  const match =
    // The unit is lazy so a trailing currency code is read as the code.
    /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([A-Za-z]*?)\s*([A-Z]{3})?$/.exec(
      rest,
    );
  if (match === null) return null;
  const [, whole = "", fraction, unit = "", trailingCode] = match;
  if (trailingCode !== undefined) {
    if (currency !== null && currency !== trailingCode) return null;
    if (!CODES.has(trailingCode)) return null;
    currency = trailingCode;
  }
  if (currency === null) return null;
  const multiplier = MULTIPLIERS[unit.toLowerCase()];
  if (multiplier === undefined) return null;
  const figure = `${whole.replaceAll(",", "")}${fraction === undefined ? "" : `.${fraction}`}`;
  const amount = scale(figure, multiplier);
  if (amount === null || /^0+(?:\.0+)?$/.test(amount)) return null;
  // Beyond any plausible single commitment: a misheard figure, not money.
  if ((amount.split(".")[0] ?? "").length > 13) return null;
  return { amount, currencyCode: currency };
}

/** Which side said it, when the call's record names the speaker. */
export function sideOfParty(
  party: string,
  attendees: readonly {
    readonly name: string;
    readonly side: "FOUNDER" | "INVESTOR" | null;
  }[],
): "COMPANY" | "INVESTOR" | null {
  const name = party.trim().toLowerCase();
  const found = attendees.find(
    (attendee) => attendee.name.trim().toLowerCase() === name,
  );
  if (found?.side === "FOUNDER") return "COMPANY";
  if (found?.side === "INVESTOR") return "INVESTOR";
  return null;
}
