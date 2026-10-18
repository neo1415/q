import { readWord, wordsOf } from "./script.js";
import { soundForm, soundSimilarity } from "./sound.js";

/**
 * Proper-name intelligence, step 3: one word of a name made comparable.
 * A token carries every sound form it may legitimately have (a joined
 * "Alhassan" is also "Hassan"; "Abdulrahman" is "Abd" + "Rahman"), and
 * whether its script wrote vowels. Similarity is the best pairing of
 * forms. Nothing here decides identity.
 */

export type NameToken = {
  /** As written (first spelling seen). */
  readonly text: string;
  /** Sound forms this token may take; the first is the primary. */
  readonly forms: readonly string[];
  /** Arabic script: vowels were never written. */
  readonly vowelless: boolean;
};

/** Arabic definite article, in the spellings romanisers use. */
const ARTICLES = new Set([
  "al",
  "el",
  "ul",
  "ol",
  "ar",
  "as",
  "at",
  "az",
  "an",
  "ad",
  "ash",
  "ath",
  "adh",
  "ed",
  "es",
  "er",
  "en",
]);
const ARABIC_ARTICLE = "ال";

/** Heads that fuse with the next word: Abd al-Rahman, Salah al-Din. */
const FUSING_HEADS = new Set([
  "abd",
  "abdul",
  "abdel",
  "abdal",
  "abdol",
  "abdu",
  "abu",
  "umm",
  "ummu",
  "salah",
  "sala",
  "nur",
  "noor",
  "nour",
  "saif",
  "sayf",
  "jamal",
  "kamal",
  "fakhr",
  "shams",
  "zain",
  "zayn",
  "baha",
  "bahaa",
  "izz",
  "ez",
  "ezz",
  "sharaf",
  "taj",
]);

const hasArabic = (word: string): boolean => /[؀-ۿ]/u.test(word);

function stripArabicArticle(word: string): string {
  return word.startsWith(ARABIC_ARTICLE) && word.length > 3
    ? word.slice(ARABIC_ARTICLE.length)
    : word;
}

/** "Abdulrahman", "Abdelaziz", "Abd" + "Rahman" all meet at "abd" + stem. */
function abdStem(letters: string): string {
  const joined = /^abd(?:ul|el|al|ol)?([a-z]{3,})$/u.exec(letters);
  if (joined?.[1] !== undefined) return `abd${joined[1]}`;
  return letters;
}

function tokenOf(text: string, override?: string): NameToken {
  const read = readWord(text);
  const letters = override ?? read.letters;
  const forms = new Set<string>([soundForm(abdStem(letters))]);
  // Joined article ("Alhassan", "Elsayed"): also the bare word.
  const joined = /^(?:al|el)([a-z]{4,})$/u.exec(letters);
  if (joined?.[1] !== undefined) forms.add(soundForm(joined[1]));
  return {
    text,
    forms: [...forms].filter((form) => form.length > 0),
    vowelless: read.vowelless,
  };
}

const isArticle = (word: string | undefined): boolean =>
  word !== undefined &&
  !hasArabic(word) &&
  ARTICLES.has(readWord(word).letters);

/** Heads that always fuse with the word after them: Abd Rahman, Abu Bakr. */
const HARD_HEADS = new Set([
  "abd",
  "abdul",
  "abdel",
  "abdal",
  "abdol",
  "abdu",
  "abu",
  "umm",
  "ummu",
]);

/**
 * Words to tokens: articles dropped, fusing heads merged with the word
 * after them (Abd al-Rahman is one token, as is Abdulrahman).
 */
export function tokenize(text: string): readonly NameToken[] {
  const words = wordsOf(text).map((word) =>
    hasArabic(word) ? stripArabicArticle(word) : word,
  );
  const tokens: NameToken[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    const folded = readWord(word).letters;
    if (folded.length === 0) continue;
    if (isArticle(word) && words.length > 1) continue;
    const skip = isArticle(words[i + 1]) ? 2 : 1;
    const next = words[i + skip];
    const fuses =
      next !== undefined &&
      (HARD_HEADS.has(folded) || (FUSING_HEADS.has(folded) && skip === 2));
    if (fuses) {
      const head = folded.startsWith("abd") ? "abd" : folded;
      tokens.push(
        tokenOf(`${word} ${next}`, `${head}${readWord(next).letters}`),
      );
      i += skip;
      continue;
    }
    tokens.push(tokenOf(word));
  }
  return tokens;
}

/** Best similarity between two tokens over every pairing of their forms. */
export function tokenSimilarity(a: NameToken, b: NameToken): number {
  const unwritten = a.vowelless || b.vowelless;
  let best = 0;
  for (const left of a.forms) {
    for (const right of b.forms) {
      best = Math.max(best, soundSimilarity(left, right, unwritten));
    }
  }
  return best;
}
