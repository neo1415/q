/**
 * Figures as founders actually write them, in decks from Lagos, Nairobi,
 * Johannesburg, Dubai, Paris and Berlin: "₦450m", "KSh 120 mn", "R15m",
 * "1,5 M€", "1 500 000 EUR", "1.500.000 €", "AED 3 Mrd", "٤٥٠ مليون"'s
 * digits. Deterministic, no model, and never a float: the amount is a
 * decimal string computed by moving the decimal point, so "1,5 M€" is
 * exactly "1500000" and money stays numeric + ISO currency end to end.
 *
 * Currency symbols and codes are reference data (ISO 4217 and the symbols
 * that stand for them), not a guess at meaning. A bare "$" is recorded as
 * USD with `currencyCertain: false`, because a Canadian or Australian deck
 * writes "$" too: the caller decides whether that is enough.
 *
 * Unknown stays unknown: a figure with no currency has `currency: null`,
 * never the founder's or the platform's default.
 */

export type MoneyUnit =
  "ONE" | "THOUSAND" | "LAKH" | "MILLION" | "CRORE" | "BILLION";

export type ParsedMoney = {
  /** Canonical decimal string, scaled: "1,5 M€" → "1500000". */
  readonly amount: string;
  /** ISO 4217 code the text states, or null when it states none. */
  readonly currency: string | null;
  /** False when only an ambiguous symbol ("$") named the currency. */
  readonly currencyCertain: boolean;
  /** The scale word or letter the text used. */
  readonly unit: MoneyUnit;
  /** The exact characters the figure was read from. */
  readonly text: string;
};

/** Symbols and codes → ISO 4217. Longest first where one prefixes another. */
const CURRENCY_TOKENS: readonly (readonly [string, string, boolean])[] = [
  ["US$", "USD", true],
  ["CA$", "CAD", true],
  ["C$", "CAD", true],
  ["AU$", "AUD", true],
  ["A$", "AUD", true],
  ["NZ$", "NZD", true],
  ["S$", "SGD", true],
  ["GH₵", "GHS", true],
  ["GH¢", "GHS", true],
  ["KSh", "KES", true],
  ["Ksh", "KES", true],
  ["KShs", "KES", true],
  ["د.إ", "AED", true],
  ["₦", "NGN", true],
  ["₹", "INR", true],
  ["₵", "GHS", true],
  ["£", "GBP", true],
  ["€", "EUR", true],
  ["$", "USD", false],
  ["R", "ZAR", true],
];

const ISO_CODES = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "ZAR",
  "AED",
  "INR",
  "SGD",
  "GHS",
  "EGP",
  "MAD",
  "SAR",
  "QAR",
  "RWF",
  "UGX",
  "TZS",
  "XOF",
  "XAF",
  "ETB",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "JPY",
  "CNY",
  "BRL",
] as const;

/**
 * Scale words and letters, including the French/German "Mio"/"Mrd"/
 * "milliard" and the Arabic ألف / مليون / مليار that sit beside
 * Arabic-Indic digits: units, like "million", not interpretations.
 */
const SCALES: readonly (readonly [RegExp, MoneyUnit, number])[] = [
  [/^(?:thousand|thousands|tsd|ألف|آلاف)$/iu, "THOUSAND", 3],
  [/^(?:million|millions|mio|mln|mn|mm|m|مليون|ملايين)$/iu, "MILLION", 6],
  [/^(?:billion|billions|milliard|milliards|mrd|bn|b|مليار)$/iu, "BILLION", 9],
  [/^(?:lakh|lakhs|lac)$/i, "LAKH", 5],
  [/^(?:crore|crores|cr)$/i, "CRORE", 7],
  [/^k$/i, "THOUSAND", 3],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SYMBOL_ALTERNATION = [
  ...CURRENCY_TOKENS.map(([token]) => token),
  ...ISO_CODES,
]
  .toSorted((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

const SCALE_ALTERNATION =
  "thousands|thousand|millions|million|milliards|milliard|billions|billion|lakhs|lakh|crores|crore|ملايين|مليون|مليار|آلاف|ألف|tsd|mio|mln|mrd|lac|mn|mm|bn|cr|k|m|b";

/**
 * currency? number scale? currency?
 * The number allows grouping by comma, dot, space, NBSP, narrow NBSP or
 * apostrophe (Swiss), and a decimal comma or dot.
 */
const FIGURE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])` +
    String.raw`(?:(${SYMBOL_ALTERNATION})\s?)?` +
    String.raw`(\d{1,3}(?:[,. '\u00a0\u202f\u2009]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)` +
    String.raw`(?:\s?(${SCALE_ALTERNATION})\.?)?` +
    String.raw`(?:\s?(${SYMBOL_ALTERNATION}))?` +
    String.raw`(?![\p{L}\p{N}])`,
  "giu",
);

/** Arabic-Indic and Extended Arabic-Indic digits and separators → ASCII. */
export function normaliseDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48),
    )
    .replace(/[۰-۹]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 48),
    )
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

function currencyOf(token: string | undefined): {
  readonly code: string | null;
  readonly certain: boolean;
} {
  if (token === undefined) return { code: null, certain: true };
  const symbol = CURRENCY_TOKENS.find(([t]) => t === token);
  if (symbol !== undefined) return { code: symbol[1], certain: symbol[2] };
  const upper = token.toUpperCase();
  return (ISO_CODES as readonly string[]).includes(upper)
    ? { code: upper, certain: true }
    : { code: null, certain: true };
}

/**
 * Splits a written number into integer digits and fraction digits,
 * deciding which separator is the decimal one from the shape alone:
 *
 *   1,500,000 / 1.500.000 / 1 500 000   repeated separator: grouping
 *   1.500,25 / 1,500.25                 both: the last one is decimal
 *   1,5 / 1,25                          one comma, not 3 digits: decimal
 *   1,500                               one comma, 3 digits: grouping
 *   1.5 / 1.500                         one dot: decimal (as written in
 *                                       English decks, "1.500m" is 1.5m)
 */
function splitNumber(
  raw: string,
): { readonly whole: string; readonly fraction: string } | null {
  const text = raw.replace(/[ '\u00a0\u202f\u2009]/g, (s) =>
    s === "'" ? "" : " ",
  );
  const spaced = text.replace(/ /g, "");
  const commas = (spaced.match(/,/g) ?? []).length;
  const dots = (spaced.match(/\./g) ?? []).length;
  let whole: string;
  let fraction = "";
  if (commas > 0 && dots > 0) {
    const decimal =
      spaced.lastIndexOf(",") > spaced.lastIndexOf(".") ? "," : ".";
    const group = decimal === "," ? "." : ",";
    const [w = "", f = ""] = spaced.split(group).join("").split(decimal);
    whole = w;
    fraction = f;
  } else if (commas > 1 || dots > 1) {
    whole = spaced.replace(/[.,]/g, "");
  } else if (commas === 1) {
    const [w = "", f = ""] = spaced.split(",");
    if (f.length === 3) whole = w + f;
    else {
      whole = w;
      fraction = f;
    }
  } else if (dots === 1) {
    const [w = "", f = ""] = spaced.split(".");
    whole = w;
    fraction = f;
  } else {
    whole = spaced;
  }
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  return { whole, fraction };
}

/** whole.fraction × 10^shift, as a canonical decimal string. */
function scaleDecimal(whole: string, fraction: string, shift: number): string {
  const digits = whole + fraction;
  const point = whole.length + shift;
  const padded = point > digits.length ? digits.padEnd(point, "0") : digits;
  const intPart = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const fracPart = padded.slice(point).replace(/0+$/, "");
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

function unitOf(token: string | undefined): {
  readonly unit: MoneyUnit;
  readonly shift: number;
} {
  if (token === undefined) return { unit: "ONE", shift: 0 };
  for (const [pattern, unit, shift] of SCALES) {
    if (pattern.test(token)) return { unit, shift };
  }
  return { unit: "ONE", shift: 0 };
}

/** Every figure in the text, in order. */
export function parseMoneyAll(text: string): readonly ParsedMoney[] {
  const normalised = normaliseDigits(text);
  const found: ParsedMoney[] = [];
  for (const match of normalised.matchAll(FIGURE)) {
    const [whole, before, number, scale, after] = match;
    if (number === undefined) continue;
    // "R" alone is the rand only before a number, never trailing one.
    const trailing = after === "R" ? undefined : after;
    const split = splitNumber(number);
    if (split === null) continue;
    const { unit, shift } = unitOf(scale);
    const currency = currencyOf(before ?? trailing);
    found.push({
      amount: scaleDecimal(split.whole, split.fraction, shift),
      currency: currency.code,
      currencyCertain: currency.code === null ? true : currency.certain,
      unit,
      text: whole.trim(),
    });
  }
  return found;
}

/**
 * The figure a short answer or a deck line states: the first one naming a
 * currency, else the first with a scale, else the first number. Null when
 * the text holds no number.
 */
export function parseMoney(text: string): ParsedMoney | null {
  const all = parseMoneyAll(text);
  return (
    all.find((m) => m.currency !== null) ??
    all.find((m) => m.unit !== "ONE") ??
    all[0] ??
    null
  );
}

/**
 * A decimal string rounded half-up to two places, always with two places
 * when it has a fraction: the shape `parseFigure` has always returned.
 */
export function roundToCents(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length === 0) return whole;
  const cents = BigInt(whole + fraction.slice(0, 2).padEnd(2, "0"));
  const up = (fraction[2] ?? "0") >= "5" ? 1n : 0n;
  const total = (cents + up).toString().padStart(3, "0");
  return `${total.slice(0, -2)}.${total.slice(-2)}`;
}
