/**
 * What language a piece of text is in, as far as code can tell without a
 * model: whether it is English (the one language Capital Q's own code
 * writes in), and, for a script that names its language, which one.
 *
 * Moved from q-api's onboarding reply rule (lane ml) so the answer path
 * shares it (QA F-96, 24 Oct 2026: an Arabic answer ended with code's
 * English "They're on screen.").
 */

/**
 * Small words nearly every English sentence has. Used only to tell
 * whether text is English, never to name any other language.
 */
const ENGLISH_WORDS = new Set(
  `a an the and or but if so of to in on at by for with from about as is are
  was were be been am do does did have has had i i'm i've we we're our us my
  me you your it it's its they them their this that these those there here
  what which who how when where why yes no not yeah yep nope ok okay sure
  just about around per each one two three four five six seven eight nine
  ten hundred thousand million billion please thanks thank can will would
  could should may might must also only still very more most less than then
  now today currently already`.split(/\s+/u),
);

/**
 * Whether text is in English, or carries no language of its own (a figure,
 * a name, a list of names): then the default stands. Text in a script
 * other than Latin is not English.
 */
export function textIsEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return true;
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  if (latin.length < letters.length * 0.6) return false;
  // Only lower-case words say anything about the language: capitalised
  // words are names as often as not ("Rimal Freight, Dubai, seed").
  const words = (text.match(/[\p{L}']+/gu) ?? [])
    .filter((word) => word === word.toLowerCase())
    .map((word) => word.replace(/'+$/u, ""));
  if (words.length <= 2) return true;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return english >= 1 && english / words.length >= 0.15;
}

/** Scripts that name one language (Cyrillic and Latin name many: none). */
const SCRIPT_LANGUAGE: readonly (readonly [RegExp, string])[] = [
  [/\p{Script=Arabic}/gu, "ar"],
  [/\p{Script=Hebrew}/gu, "he"],
  [/\p{Script=Hangul}/gu, "ko"],
  [/\p{Script=Han}/gu, "zh"],
  [/\p{Script=Devanagari}/gu, "hi"],
  [/\p{Script=Thai}/gu, "th"],
  [/\p{Script=Greek}/gu, "el"],
];

/**
 * The language a text's script names, when most of its letters are in a
 * script that names one; null otherwise (Latin, Cyrillic, mixed, none).
 */
export function scriptLanguageOf(text: string): string | null {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return null;
  // Japanese writes most words in Han characters; any kana says Japanese.
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? [])
    .length;
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  if (kana > 0 && kana + han >= letters * 0.5) return "ja";
  for (const [script, tag] of SCRIPT_LANGUAGE) {
    const count = (text.match(script) ?? []).length;
    if (count >= letters * 0.5) return tag;
  }
  return null;
}
