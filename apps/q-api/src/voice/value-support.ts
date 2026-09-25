/**
 * Whether a value recorded as STATED is one the person's quote actually
 * gives (unknown stays unknown; ACC 2026-09-25).
 *
 * P0-2 checked that a quote is the person's own words. It did not check
 * that the value comes from that quote, so a turn could write a figure
 * nobody said — the midpoint 62,500 of "cheques from 25 to 100 thousand"
 * — or put one step's answer in another's words ("Angel investor" as a
 * business title from "I'm an angel"). These checks are structural, not
 * semantic: digits and the person's own characters, never a word list.
 * What the words MEAN (which option, which category) stays the model's
 * reading, validated by the step; what they literally STATE is checked
 * here.
 */

/** Digit sequences in text, with grouping and decimal marks between digits removed. */
function digitRuns(text: string): string[] {
  const runs: string[] = [];
  for (const match of text.matchAll(/\d(?:[\d\s,.'\u00a0\u202f]*\d)?/g)) {
    // "25 to 100" is two figures; "25 000" (a space-grouped thousand) is one.
    for (const part of match[0].split(/\s(?!\d{3}(?!\d))/)) {
      const digits = part.replace(/\D/g, "");
      if (digits.length > 0) runs.push(digits);
    }
  }
  return runs;
}

/** A figure's significant digits: no sign, no decimal mark, no zeros at either end. */
function significant(digits: string): string {
  const trimmed = digits.replace(/^0+/, "").replace(/0+$/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}

/**
 * Whether `value` (a plain number, in the step's unit) is a figure the
 * quote states: the same significant digits as a figure in it. The scale
 * ("25k", "25 thousand", "25,000") is not checked here — a figure
 * without its scale is the ambiguity the conversation asks about — but a
 * figure the quote does not contain at all is refused.
 *
 * `null`: the quote states no figure in digits (a number said in words),
 * so this cannot be checked from it.
 */
export function figureStatedIn(value: string, quote: string): boolean | null {
  const wanted = significant(value.replace(/\D/g, ""));
  const runs = digitRuns(quote);
  if (runs.length === 0) return null;
  return runs.some((run) => significant(run) === wanted);
}

/**
 * How many times the quote states `value`'s figure: a figure stated once
 * answers one step. "Cheques from 25 to 100 thousand" gives a minimum of
 * 25,000; it does not also give a typical cheque of 25,000.
 */
export function figureCountIn(value: string, quote: string): number {
  const wanted = significant(value.replace(/\D/g, ""));
  return digitRuns(quote).filter((run) => significant(run) === wanted).length;
}

/** Letters and digits in any script, case folded, single-spaced. */
function normalised(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether free text is the person's own words: the value, compared on
 * letters and digits only, occurs within the quote.
 */
export function textStatedIn(value: string, quote: string): boolean {
  const wanted = normalised(value);
  if (wanted.length === 0) return false;
  return ` ${normalised(quote)} `.includes(` ${wanted} `);
}
