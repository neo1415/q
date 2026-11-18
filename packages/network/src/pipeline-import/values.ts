/**
 * Deterministic reading of one cell (decision 106). Unknown stays unknown:
 * a value that cannot be read exactly is kept as the person wrote it and
 * left out of the typed field, never guessed into one. A money figure is an
 * exact decimal string and an ISO currency, never a float.
 */

/** Legal-form words that do not tell two organisations apart. */
const LEGAL_SUFFIX =
  /\s+(inc|incorporated|ltd|limited|llc|llp|lp|plc|gmbh|ag|sa|sas|bv|nv|pty|corp|corporation|co|company)$/;

/** Name text for matching: "Acme, Inc." and "ACME Inc" read the same. */
export function nameKey(name: string): string {
  // A trailing parenthetical is a label, not the name ("Acme (UK)").
  let key = name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (let guard = 0; guard < 3 && LEGAL_SUFFIX.test(key); guard += 1) {
    key = key.replace(LEGAL_SUFFIX, "").trim();
  }
  return key.replace(/\s+/g, "");
}

/** Webmail and generic hosts: an email there names a person, not a firm. */
const GENERIC_EMAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

const HOST =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** "https://www.Acme.io/about" -> "acme.io"; null when not a host. */
export function domainOf(value: string): string | null {
  let text = value.trim().toLowerCase();
  if (text === "") return null;
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.split(/[/?#\s]/)[0] ?? "";
  text = text
    .replace(/:\d+$/, "")
    .replace(/^www\d?\./, "")
    .replace(/\.$/, "");
  return text.length <= 253 && HOST.test(text) && /\.[a-z]{2,}$/.test(text)
    ? text
    : null;
}

/** The firm's domain from an email address, unless it is a webmail host. */
export function emailDomainOf(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at === -1) return null;
  const host = domainOf(email.trim().slice(at + 1));
  return host === null || GENERIC_EMAIL_HOSTS.has(host) ? null : host;
}

export function emailOf(value: string): string | null {
  const text = value.trim().toLowerCase();
  return /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/.test(text) && text.length <= 254
    ? text
    : null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A calendar date (YYYY-MM-DD) or null. Accepts ISO dates and timestamps,
 * "12 Mar 2026", "March 12, 2026", and d/m/y or m/d/y only when the day is
 * unambiguous (above 12): "03/04/2026" could be either and stays unknown.
 * An Excel serial number is read only when `excelSerial` is set (an XLSX
 * cell, which stores dates that way).
 */
export function dateOf(
  value: string,
  options: { readonly excelSerial?: boolean } = {},
): string | null {
  const text = value.trim();
  if (text === "") return null;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (match !== null) {
    return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match !== null) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);
    if (a > 12 && b <= 12) return isoDate(year, b, a);
    if (b > 12 && a <= 12) return isoDate(year, a, b);
    return a === b ? isoDate(year, a, b) : null;
  }
  match = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{4})$/i.exec(
    text,
  );
  if (match !== null) {
    const month =
      MONTHS[(match[2] ?? "").toLowerCase().slice(0, 4)] ??
      MONTHS[(match[2] ?? "").toLowerCase().slice(0, 3)];
    return month === undefined
      ? null
      : isoDate(Number(match[3]), month, Number(match[1]));
  }
  match = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(text);
  if (match !== null) {
    const month =
      MONTHS[(match[1] ?? "").toLowerCase().slice(0, 4)] ??
      MONTHS[(match[1] ?? "").toLowerCase().slice(0, 3)];
    return month === undefined
      ? null
      : isoDate(Number(match[3]), month, Number(match[2]));
  }
  if (options.excelSerial === true && /^\d{4,6}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    // 1900 date system; serial 60 is Excel's fictitious 29 Feb 1900.
    if (serial > 60 && serial < 110_000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "₦": "NGN",
  "¥": "JPY",
  "₹": "INR",
  KSh: "KES",
  C$: "CAD",
  A$: "AUD",
};

export function currencyOf(value: string): string | null {
  const text = value.trim();
  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
  return CURRENCY_SYMBOLS[text] ?? null;
}

/** Multiply an exact decimal string by 10^power, without floats. */
function shiftDecimal(digits: string, power: number): string {
  const [whole = "0", fraction = ""] = digits.split(".");
  const padded = fraction.padEnd(power, "0");
  const moved = whole + padded.slice(0, power);
  const rest = padded.slice(power).replace(/0+$/, "");
  const integer = moved.replace(/^0+(?=\d)/, "");
  return rest === "" ? integer : `${integer}.${rest}`;
}

/**
 * "$1.5M" -> {amount: "1500000", currency: "USD"}; "250k" -> {"250000",
 * null}; "USD 2,000,000" -> {"2000000", "USD"}. A range ("1-2M") or a
 * word ("TBD") is not an amount: null, and the cell stays in the notes.
 */
export function moneyOf(
  value: string,
): { readonly amount: string; readonly currency: string | null } | null {
  let text = value.trim().replace(/\s+/g, " ");
  if (text === "") return null;
  let currency: string | null = null;
  const code =
    /^([A-Za-z]{3})\s?(?=[\d.])|(?<=[\d.kmbKMB])\s?([A-Za-z]{3})$/.exec(text);
  if (code !== null) {
    currency = (code[1] ?? code[2] ?? "").toUpperCase();
    text = text.replace(code[0], "").trim();
  }
  const symbol = /^(US\$|C\$|A\$|KSh|[$€£₦¥₹])\s?/.exec(text);
  if (symbol !== null) {
    currency = currency ?? CURRENCY_SYMBOLS[symbol[1] ?? ""] ?? null;
    text = text.slice(symbol[0].length);
  }
  const match =
    /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|m|mm|mn|b|bn|thousand|million|billion)?$/i.exec(
      text,
    );
  if (match === null) return null;
  const digits = `${(match[1] ?? "").replace(/,/g, "")}${match[2] ?? ""}`;
  const unit = (match[3] ?? "").toLowerCase();
  const power =
    unit === "k" || unit === "thousand"
      ? 3
      : unit === "m" || unit === "mm" || unit === "mn" || unit === "million"
        ? 6
        : unit === "b" || unit === "bn" || unit === "billion"
          ? 9
          : 0;
  const amount =
    power === 0 ? digits.replace(/^0+(?=\d)/, "") : shiftDecimal(digits, power);
  return /^(0|[1-9]\d*)(\.\d+)?$/.test(amount) && amount.length <= 30
    ? { amount, currency }
    : null;
}
