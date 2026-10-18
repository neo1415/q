/**
 * Proper-name intelligence, step 1: reading a name in either script into
 * one comparable form. Arabic script is romanised to a consonant skeleton
 * (short vowels are not written in Arabic, so none are invented); Latin is
 * folded so the common alternate romanisations meet. Pure, deterministic.
 */

const ARABIC_LETTER: Readonly<Record<string, string>> = {
  ا: "a",
  أ: "a",
  إ: "i",
  آ: "a",
  ٱ: "a",
  ء: "",
  ب: "b",
  پ: "p",
  ت: "t",
  ث: "th",
  ج: "j",
  چ: "ch",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  ژ: "zh",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ڤ: "v",
  ق: "q",
  ك: "k",
  ک: "k",
  گ: "g",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  ة: "a",
  ى: "a",
  ي: "i",
  ی: "i",
  ئ: "i",
  ؤ: "u",
  و: "u",
};

const ARABIC_RANGE = /[؀-ۿݐ-ݿ]/u;
/** Tashkeel, tatweel and the Quranic marks: pronunciation, not spelling. */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/gu;

export const hasArabicScript = (text: string): boolean =>
  ARABIC_RANGE.test(text);

/** Arabic script to a vowel-less Latin skeleton; other text passes through. */
export function romanizeArabic(text: string): string {
  const chars = [...text.normalize("NFC").replace(ARABIC_MARKS, "")];
  let out = "";
  chars.forEach((char, index) => {
    const mapped = ARABIC_LETTER[char];
    if (mapped === undefined) {
      out += char;
      return;
    }
    const previous = chars[index - 1];
    const wordStart = previous === undefined || !ARABIC_RANGE.test(previous);
    // Waw and ya open a word as consonants (Wael, Yusuf), else are vowels.
    if (wordStart && char === "و") out += "w";
    else if (wordStart && (char === "ي" || char === "ی")) out += "y";
    else out += mapped;
  });
  return out;
}

/** Marks that carry no letter: accents, apostrophes, ayn/hamza signs. */
const STRIP_MARKS = /[\p{M}'`´ʿʾʼʻ’‘ʹ]/gu;

/** Latin: lowercase, no accents, no ayn/hamza marks, letters only. */
export function foldLatin(text: string): string {
  return text
    .normalize("NFKD")
    .replace(STRIP_MARKS, "")
    .toLowerCase()
    .replace(/ß/gu, "ss")
    .replace(/[^a-z]/gu, "");
}

/**
 * The letters of a word as one folded string, from either script.
 * `vowelless` says the source never wrote vowels (Arabic script), so a
 * comparison may not count missing vowels against it.
 */
export function readWord(word: string): {
  readonly letters: string;
  readonly vowelless: boolean;
} {
  const arabic = hasArabicScript(word);
  return {
    letters: foldLatin(arabic ? romanizeArabic(word) : word),
    vowelless: arabic,
  };
}

/** The words of a name: letters only, hyphens and underscores split. */
export function wordsOf(text: string): readonly string[] {
  return (
    text
      .normalize("NFC")
      .replace(/[‐-―_]/gu, " ")
      .match(/[\p{L}\p{M}'’ʿʾ]+/gu) ?? []
  ).filter((word) => /\p{L}/u.test(word));
}
