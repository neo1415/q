/**
 * How a reply agrees to what Q read back (owner, 9 Nov: typed and voice
 * accept the same way). Pure functions of the words: code decides, never a
 * reading of meaning. Shared by the typed engine and the spoken reading.
 */

export const plainWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$€£]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const TEENS: Readonly<Record<string, number>> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const FRACTIONS: Readonly<Record<string, number>> = {
  half: 0.5,
  quarter: 0.25,
};
/** Scales a word may carry; the short ones only straight after digits. */
const WORD_SCALES: Readonly<Record<string, number>> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};
const DIGIT_SCALES: Readonly<Record<string, number>> = {
  k: 1e3,
  m: 1e6,
  mn: 1e6,
  bn: 1e9,
};
/** Words that join the parts of one spoken number ("two and a half million"). */
const JOINERS = new Set(["and", "a", "an"]);

type Part =
  | "unit"
  | "teen"
  | "ten"
  | "hundred"
  | "scale"
  | "digit"
  | "fraction"
  | "point";

/**
 * The figures a text gives, as numbers: digits with a scale ("500k",
 * "3.5 million"), or a number said in words, read whole.
 *
 * Owner, live duplex voice 9 Nov: Q read cheques back as it speaks them
 * ("five hundred thousand", "three million"), and this read each word on
 * its own (5, 100, 3), so no read-back ever matched the held 500000 and
 * every yes fell through: the same question, again and again. A spoken
 * number is one figure; its words are composed, never read apart.
 */
export function figuresOf(text: string): ReadonlySet<number> {
  const found = new Set<number>();
  const tokens =
    text.toLowerCase().match(/\d[\d,]*(?:\.\d+)?(?:k|mn|m|bn)?\b|[a-z]+/gu) ??
    [];
  let total = 0;
  let group = 0;
  let fraction = 0;
  let decimals = 0;
  let lastScale = Infinity;
  let last: Part | null = null;
  // A figure given in digits is whole: words after it are a new figure
  // ("300k and twelve towns"), only a scale word extends it.
  let digitMade = false;
  const flush = () => {
    if (last !== null) {
      const value = Math.round(total + group + fraction);
      found.add(value);
    }
    total = 0;
    group = 0;
    fraction = 0;
    decimals = 0;
    lastScale = Infinity;
    last = null;
    digitMade = false;
  };
  for (const token of tokens) {
    if (/^\d/u.test(token)) {
      flush();
      const digits = /^([\d,]*\d(?:\.\d+)?)(k|mn|m|bn)?$/u.exec(token);
      const base = Number((digits?.[1] ?? "").replace(/,/gu, ""));
      if (!Number.isFinite(base)) continue;
      const scale =
        digits?.[2] === undefined ? 1 : (DIGIT_SCALES[digits[2]] ?? 1);
      digitMade = true;
      if (scale > 1) {
        total = base * scale;
        lastScale = scale;
        last = "scale";
      } else {
        group = base;
        last = "digit";
      }
      continue;
    }
    const unit = UNITS[token];
    const teen = TEENS[token];
    const ten = TENS[token];
    if (
      digitMade &&
      (unit !== undefined || teen !== undefined || ten !== undefined)
    )
      flush();
    if (last === "point" && unit !== undefined) {
      decimals += 1;
      group += unit / 10 ** decimals;
      continue;
    }
    if (unit !== undefined) {
      // "three seven" or "five, six" are two figures, "twenty five" one.
      if (
        last !== null &&
        last !== "ten" &&
        last !== "hundred" &&
        last !== "scale"
      )
        flush();
      group += unit;
      last = "unit";
      continue;
    }
    if (teen !== undefined || ten !== undefined) {
      if (last !== null && last !== "hundred" && last !== "scale") flush();
      group += teen ?? ten ?? 0;
      last = teen !== undefined ? "teen" : "ten";
      continue;
    }
    if (token === "hundred") {
      group = (group === 0 ? 1 : group) * 100;
      last = "hundred";
      continue;
    }
    const fractionOf = FRACTIONS[token];
    if (fractionOf !== undefined) {
      fraction += fractionOf;
      last = last ?? "fraction";
      continue;
    }
    if (token === "point" && last !== null && last !== "point") {
      last = "point";
      continue;
    }
    const scale = WORD_SCALES[token];
    if (scale !== undefined) {
      // A digit straight before a scale word is its count ("500 thousand").
      // A scale as large as one already used starts a new figure
      // ("five hundred thousand and three million").
      if (scale >= lastScale && total > 0) {
        const carried = group + fraction;
        const kept = last;
        group = 0;
        fraction = 0;
        flush();
        group = carried;
        last = kept;
      }
      const count = group + fraction;
      total += (count === 0 ? 1 : count) * scale;
      group = 0;
      fraction = 0;
      decimals = 0;
      lastScale = scale;
      last = "scale";
      continue;
    }
    if (JOINERS.has(token)) continue;
    flush();
  }
  flush();
  return found;
}

const DISAGREES =
  /\b(no|not|nope|never|wrong|incorrect|but|except|instead|remove|drop)\b|n't\b/iu;

/** Words that carry no part of a held value ("Nigeria, Kenya and France"). */
const LINKING = new Set([
  "and",
  "or",
  "the",
  "a",
  "an",
  "of",
  "in",
  "with",
  "plus",
  "dot",
  "www",
  "https",
  "http",
]);

/** A word as said or written: lower case, a plural "s" off ("dollars"). */
const stem = (word: string) =>
  word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;

const contentWords = (text: string): string[] =>
  plainWords(text.replace(/\./gu, " "))
    .split(" ")
    .filter((word) => word.length > 0 && !LINKING.has(word))
    .map(stem);

/**
 * Whether a line names a held value given in words: every word that
 * carries the value is in the line, in any order (owner, 9 Nov: how Q
 * says a value back is never character for character the stored text,
 * "Nigeria, Kenya, France" is said "Nigeria, Kenya and France",
 * "acme.com" is "acme dot com", "US dollar" is "US dollars"). Code
 * decides, never a reading of meaning.
 */
export function namesValue(value: string, line: string): boolean {
  const wanted = contentWords(value);
  if (wanted.join("").length < 3) return false;
  const said = new Set(contentWords(line));
  return wanted.every((word) => said.has(word));
}

/**
 * The held suggestions Q's last line put to them: the one for the step it
 * asked, then every other one whose value that line read back with it (the
 * finishing line reads a set back in one go), at most four.
 */
export function heldOfferedIn<
  T extends { readonly stepKey: string; readonly value: string },
>(pending: readonly T[], asked: string, lastQ: string): T[] {
  const first = pending.filter((item) => item.stepKey === asked).slice(0, 1);
  const withIt = pending.filter((item) => {
    if (item.stepKey === asked) return false;
    const figures = figuresOf(item.value);
    if (figures.size > 0) {
      const said = figuresOf(lastQ);
      return [...figures].every((figure) => said.has(figure));
    }
    return namesValue(item.value, lastQ);
  });
  return first.length === 0 ? [] : [...first, ...withIt].slice(0, 4);
}

/**
 * Which held suggestions their reply restates: a reply that says the very
 * values Q read back agrees to them. With figures, every figure of each
 * held value is in their words and they name no other figure (so a
 * different range is never taken as a yes); without figures, their words
 * contain the held words. Never a reading of meaning.
 */
export function restatedHeld(
  held: readonly { readonly stepKey: string; readonly value: string }[],
  utterance: string,
): string[] {
  const said = figuresOf(utterance);
  const withFigures = held.filter((item) => figuresOf(item.value).size > 0);
  const named = new Set(
    withFigures.flatMap((item) => [...figuresOf(item.value)]),
  );
  const figuresAgree =
    said.size > 0 &&
    [...said].every((figure) => named.has(figure)) &&
    [...named].every((figure) => said.has(figure));
  return held
    .filter((item) => {
      if (figuresOf(item.value).size > 0) return figuresAgree;
      // "No, not Nigeria" names the held word too: never a yes.
      return !DISAGREES.test(utterance) && namesValue(item.value, utterance);
    })
    .map((item) => item.stepKey);
}

/** A reply that is a plain yes and nothing else. */
const PLAIN_YES = new Set([
  "yes",
  "yes please",
  "yep",
  "yeah",
  "yes that's right",
  "yes that is right",
  "that's right",
  "that is right",
  "correct",
  "yes correct",
  "right",
  "sure",
  "ok",
  "okay",
  "go ahead",
  "sounds good",
  "perfect",
  "keep them",
  "keep these",
  "keep that",
  "keep it",
  "yes keep them",
  "yes keep these",
  "yes keep that",
  "yes keep it",
]);

/**
 * Owner, 9 Nov: "yep", "that's very correct", "exactly", "mm-hm", "go
 * ahead" are each a yes. A reply made only of agreeing words, with at
 * least one word that agrees on its own and nothing that qualifies it
 * ("but", "not", a figure), is a plain yes.
 */
const AGREES = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "correct",
  "right",
  "exactly",
  "absolutely",
  "definitely",
  "sure",
  "ok",
  "okay",
  "mhm",
  "hm",
  "perfect",
  "true",
  "indeed",
  "ahead",
  "good",
  "spot",
  "uh-huh",
  "mm-hm",
  "mm-hmm",
]);
const AGREEING_FILLER = new Set([
  "that's",
  "that",
  "it's",
  "it",
  "is",
  "very",
  "totally",
  "quite",
  "all",
  "on",
  "go",
  "please",
  "sounds",
  "mm",
  "uh",
  "huh",
  "so",
  "thanks",
  "thank",
  "you",
  "keep",
  "them",
  "these",
  "of",
]);

export function isPlainYes(utterance: string): boolean {
  const said = utterance
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (PLAIN_YES.has(said)) return true;
  const words = said.split(" ").filter((word) => word.length > 0);
  return (
    words.length > 0 &&
    words.length <= 8 &&
    words.some((word) => AGREES.has(word)) &&
    words.every((word) => AGREES.has(word) || AGREEING_FILLER.has(word))
  );
}
