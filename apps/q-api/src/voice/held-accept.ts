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

const NUMBER_WORDS: Readonly<Record<string, number>> = {
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
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
};

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
};

/** The figures a text gives, as numbers: digits with a scale, or number words. */
export function figuresOf(text: string): ReadonlySet<number> {
  const found = new Set<number>();
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(
    /(\d[\d,]*(?:\.\d+)?)\s*(k|mn|m|bn|thousand|million|billion)?\b/gu,
  )) {
    const base = Number((match[1] ?? "").replace(/,/gu, ""));
    if (!Number.isFinite(base)) continue;
    const scale = match[2] === undefined ? 1 : (SCALE[match[2]] ?? 1);
    found.add(Math.round(base * scale));
  }
  for (const word of lower.split(/[^a-z]+/u)) {
    const value = NUMBER_WORDS[word];
    if (value !== undefined) found.add(value);
  }
  return found;
}

/**
 * The held suggestions Q's last line put to them: the one for the step it
 * asked, then every other one whose value that line read back with it (the
 * finishing line reads a set back in one go), at most four.
 */
export function heldOfferedIn<
  T extends { readonly stepKey: string; readonly value: string },
>(pending: readonly T[], asked: string, lastQ: string): T[] {
  const said = plainWords(lastQ);
  const first = pending.filter((item) => item.stepKey === asked).slice(0, 1);
  const withIt = pending.filter((item) => {
    if (item.stepKey === asked) return false;
    const value = plainWords(item.value);
    return value.length >= 2 && said.includes(value);
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
  const words = plainWords(utterance);
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
      const value = plainWords(item.value);
      return value.length >= 3 && words.includes(value);
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
