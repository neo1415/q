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
  return parseExactFigure(text) ?? parseSaidFigure(text);
}

/** "dollars", "naira": the currency as said, when no symbol or code is. */
const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  dollar: "USD",
  dollars: "USD",
  usd: "USD",
  euro: "EUR",
  euros: "EUR",
  eur: "EUR",
  pound: "GBP",
  pounds: "GBP",
  gbp: "GBP",
  naira: "NGN",
  ngn: "NGN",
  rand: "ZAR",
  zar: "ZAR",
  cedi: "GHS",
  cedis: "GHS",
  shillings: "KES",
  kes: "KES",
};

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  a: "1",
  an: "1",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  fifteen: "15",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
};

/**
 * Words before a figure that make it vague: "half a million" and "one or
 * two million" stay unknown.
 */
const VAGUE_BEFORE =
  /(?:\b(?:half|quarter|few|couple|several|some|tens|hundreds|thousands|millions)\s*(?:of\s*)?|(?:\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten))\s*(?:or|to)\s*)$/i;

/**
 * meet2-64 (live 2026-10-04): the notes wrote the amount as said, "a
 * million dollars", which the exact reader above refused, so money said in
 * the call was never filed. A figure said in words or inside a phrase is
 * read when it is still exact: one number (digits or a plain number word),
 * an optional scale, and a currency by symbol, code or name. Two different
 * figures in one phrase, or a vague one, stay unknown.
 */
function parseSaidFigure(text: string): SpokenAmount | null {
  const said = text.replace(/\s+/g, " ").trim();
  const symbols = SYMBOLS.map(([symbol]) =>
    symbol.replace(/[$.]/g, (c) => `\\${c}`),
  ).join("|");
  const numberWords = Object.keys(NUMBER_WORDS).join("|");
  const pattern = new RegExp(
    `(${symbols})?\\s*(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\b(?:${numberWords})\\b)(?:[\\s-]*(hundred))?(?:[\\s-]*(k|thousand|mn|mm|m|million|bn|b|billion)\\b)?(?=(?:\\s*([A-Za-z]+)\\b)?)`,
    "gi",
  );
  const found = new Map<string, SpokenAmount>();
  for (const match of said.matchAll(pattern)) {
    const [whole, symbol, figureRaw = "", hundred, unit = "", after] = match;
    if (VAGUE_BEFORE.test(said.slice(0, match.index))) return null;
    const afterWord = after?.toLowerCase();
    const named =
      afterWord === undefined ? undefined : CURRENCY_WORDS[afterWord];
    // "$5 zillion": an unknown scale is not money we can read.
    if (
      afterWord !== undefined &&
      /illion$/.test(afterWord) &&
      named === undefined
    ) {
      return null;
    }
    const bySymbol =
      symbol === undefined
        ? undefined
        : SYMBOLS.find(([s]) => s.toLowerCase() === symbol.toLowerCase())?.[1];
    if (bySymbol !== undefined && named !== undefined && bySymbol !== named) {
      return null;
    }
    const currency = bySymbol ?? named;
    if (currency === undefined || whole.trim().length === 0) continue;
    const isWord = /^[a-z]+$/i.test(figureRaw);
    // A bare "a"/"one" with no scale or currency name is not a figure.
    if (isWord && unit === "" && hundred === undefined && named === undefined) {
      continue;
    }
    let figure = isWord
      ? (NUMBER_WORDS[figureRaw.toLowerCase()] ?? "")
      : figureRaw.replaceAll(",", "");
    if (figure === "") continue;
    if (hundred !== undefined) {
      const scaled = scale(figure, 100n);
      if (scaled === null) return null;
      figure = scaled;
    }
    const multiplier = MULTIPLIERS[unit.toLowerCase()];
    if (multiplier === undefined) return null;
    const amount = scale(figure, multiplier);
    if (amount === null) return null;
    if (/^0+(?:\.0+)?$/.test(amount)) return null;
    if ((amount.split(".")[0] ?? "").length > 13) return null;
    found.set(`${amount} ${currency}`, { amount, currencyCode: currency });
  }
  if (found.size !== 1) return null;
  return [...found.values()][0] ?? null;
}

function parseExactFigure(text: string): SpokenAmount | null {
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
