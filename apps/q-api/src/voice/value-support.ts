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

import {
  asciiDigits,
  SCALE_WORDS,
  spokenFiguresIn,
} from "./interview-steps.js";

/**
 * Whether `value` is a figure of the quote with its scale word left off:
 * 400 from "400 mille euros", 2 from "2 million". Only when the quote
 * gives those digits nowhere without a scale.
 */
export function scaleDroppedIn(value: string, quote: string): boolean {
  const wanted = Number(value);
  if (!Number.isFinite(wanted)) return false;
  const text = asciiDigits(quote).toLowerCase();
  let scaled = false;
  let bare = false;
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)(?:\s*([\p{L}]+))?/gu)) {
    const number = Number((match[1] ?? "").replace(",", "."));
    if (number !== wanted) continue;
    const scale = SCALE_WORDS[match[2] ?? ""];
    if (scale !== undefined && scale > 1) scaled = true;
    else bare = true;
  }
  if (bare) return false;
  if (scaled) return true;
  // Said in words ("مليوني دولار", "two million"): a value that is the
  // figure's digits without its scale is the figure with its scale lost.
  return spokenFiguresIn(quote).some(
    (figure) =>
      figure > wanted &&
      significantOf(String(figure)) === significantOf(String(wanted)),
  );
}

/**
 * Digit sequences in text, with grouping and decimal marks between digits
 * removed, and figures said in words as their digits: the recogniser
 * writes "one" and "five million" as often as "1" and "5,000,000", and a
 * founder was asked to say "1" for the form (live 2026-09-30).
 */
function digitRuns(raw: string): string[] {
  const text = asciiDigits(raw);
  const runs: string[] = [];
  for (const figure of spokenFiguresIn(text)) {
    if (Number.isInteger(figure)) runs.push(String(figure));
  }
  for (const match of text.matchAll(/\d(?:[\d\s,.'\u00a0\u202f]*\d)?/g)) {
    // "25 to 100" is two figures; "25 000" (a space-grouped thousand) is one.
    for (const part of match[0].split(/\s(?!\d{3}(?!\d))/)) {
      const digits = part.replace(/\D/g, "");
      if (digits.length > 0) runs.push(digits);
    }
  }
  return runs;
}

function significantOf(value: string): string {
  return significant(value.replace(/\D/g, ""));
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
 * `null`: the quote states no figure at all, in digits or in words, so
 * this cannot be checked from it.
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

/** Joining words a category's name carries that name nothing by themselves. */
const NAME_JOINERS = new Set(["and", "or", "the", "of", "for", "in", "to"]);

/**
 * Whether their words name a category: every word of its name is a word
 * of theirs, compared on letters and digits, a plural or a longer form of
 * the same stem ("health" for Healthcare) counting as the word. Live
 * 2026-10-31 ("Fjordlight Harbour Capital"): "B2B" was saved as "B2B
 * SaaS" in the mandate as the investor's own selection, though nothing
 * they said named SaaS. Structural, never a word list of meanings: which
 * category the words mean stays the reader's, but a category their words
 * do not name is the reader's reading of them, not their declaration.
 */
export function categoryNamedIn(
  displayName: string,
  words: readonly string[],
): boolean {
  const stem = (word: string) =>
    word.length > 3 ? word.replace(/(?:es|s)$/u, "") : word;
  const theirs = new Set(
    words.flatMap((text) => normalised(text).split(" ").filter(Boolean)),
  );
  const said = [...theirs].map(stem);
  const wanted = normalised(displayName)
    .split(" ")
    .filter((word) => word.length > 0 && !NAME_JOINERS.has(word))
    .map(stem);
  if (wanted.length === 0) return false;
  return wanted.every((word) =>
    said.some(
      (mine) =>
        mine === word ||
        (mine.length >= 4 &&
          word.length >= 4 &&
          (word.startsWith(mine) || mine.startsWith(word))),
    ),
  );
}
