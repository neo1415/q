/**
 * The Q Daily's honesty checks (DAILY spec §6, G4), in code.
 *
 * A model writes each story; these decide what of it survives. A quote is
 * kept only if it is in a source character for character (ignoring
 * typographic quotes and spacing). Prose is kept only if every number in
 * it is printed in a source. A deal amount is turned into dollars only
 * when the source printed it in dollars: nothing is converted or summed.
 */

function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function quoteIsVerbatim(
  quote: string,
  sources: readonly string[],
): boolean {
  const wanted = normalise(quote).replace(/^["']+|["']+$/g, "");
  if (wanted.length < 8) return false;
  return sources.some((source) => normalise(source).includes(wanted));
}

/** The numbers a text prints, as digits ("1,500" and "1500" are the same). */
export function numbersIn(text: string): readonly string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found
    .map((number) => number.replace(/,/g, "").replace(/\.0+$/, ""))
    .filter((number) => number.length > 0);
}

/** A number in `text` that no source prints. */
export function inventedNumbers(
  text: string,
  sources: readonly string[],
): readonly string[] {
  const known = new Set(sources.flatMap((source) => numbersIn(source)));
  return numbersIn(text).filter((number) => !known.has(number));
}

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/**
 * Dollars, from an amount exactly as a source printed it ("$12 million",
 * "US$1.5M", "$800,000"). Null for any other currency or shape.
 */
export function usdAmount(printed: string | null): number | null {
  if (printed === null) return null;
  const match =
    /^(?:us\s?)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|mn|mm|m|million|bn|b|billion)?\b/i.exec(
      printed.trim(),
    );
  if (match === null) return null;
  const base = Number.parseFloat((match[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale =
    match[2] === undefined ? 1 : (SCALE[match[2].toLowerCase()] ?? 1);
  const value = base * scale;
  return value > 0 && value < 1e12 ? value : null;
}

/** "$12M" style, for a diagram label; from a dollar figure a source printed. */
export function formatUsd(value: number): string {
  if (value >= 1e9) return `$${trim(value / 1e9)}B`;
  if (value >= 1e6) return `$${trim(value / 1e6)}M`;
  if (value >= 1e3) return `$${trim(value / 1e3)}K`;
  return `$${trim(value)}`;
}

function trim(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, "");
}
