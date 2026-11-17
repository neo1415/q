/**
 * The figures a memory's content states, as values, so the Write Gate can
 * hold a model's sentence to the person's quoted words (Thames Arc, 16 Nov
 * 2026: counts Q itself had said wrongly -- "4 public-sector account
 * managers", the document's row says 3 -- were recalled into later
 * conversations as if they were facts).
 *
 * A figure in a model-proposed memory must be one the person's own quote
 * states. One that only Q's answer stated is Q's earlier statement, not
 * something they told Q, and it never becomes a remembered fact.
 *
 * Structural only: digits (with a currency, percent or magnitude) and the
 * counts two to twelve written as words ("one" is too often not a count).
 */

const COUNT_WORDS = [
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

const DIGITS =
  /(?<![\p{L}\d.])\d[\d,]*(?:\.\d+)?(?:\s?(%|percent|k|m|bn|b|million|billion|thousand)(?![\p{L}]))?/giu;

const WORD = new RegExp(
  `(?<![\\p{L}-])(${COUNT_WORDS.join("|")})(?![\\p{L}-])`,
  "giu",
);

/** Each figure as a canonical value ("2400000", "12%"), deduplicated. */
export function memoryFiguresIn(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(DIGITS)) {
    const digits = (/^[\d,]*(?:\.\d+)?/u.exec(match[0])?.[0] ?? "").replace(
      /,/gu,
      "",
    );
    const unit = (match[1] ?? "").toLowerCase();
    const value = Number(digits) * (SCALE[unit] ?? 1);
    if (!Number.isFinite(value)) continue;
    found.add(
      `${String(value)}${unit === "%" || unit === "percent" ? "%" : ""}`,
    );
  }
  for (const match of text.matchAll(WORD)) {
    const index = COUNT_WORDS.indexOf(
      (match[1] ?? "").toLowerCase() as (typeof COUNT_WORDS)[number],
    );
    if (index >= 0) found.add(String(index + 2));
  }
  return found;
}

/** The content's figures the quote does not state; empty when all are. */
export function figuresNotInQuote(
  content: string,
  quote: string | null,
): readonly string[] {
  const said = memoryFiguresIn(quote ?? "");
  return [...memoryFiguresIn(content)].filter((figure) => !said.has(figure));
}
