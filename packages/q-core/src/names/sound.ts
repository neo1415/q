/**
 * Proper-name intelligence, step 2: the sound-fold and the weighted
 * distance between two folded words. Built for Arabic names written in
 * Latin letters, where Qishta/Kishta/Qeshta and Mohammed/Muhammad/Mohamed
 * are one name, and for the way English (including Nigerian English)
 * speakers and recognisers hear them: q/k/g, kh/h, u/ou/oo, doubled
 * letters, and a final -ah/-a. The distance is a graded similarity, never
 * a verdict that two records are one person.
 */

const VOWEL = new Set(["a", "e", "i", "u"]);
const isVowel = (letter: string): boolean => VOWEL.has(letter);

/**
 * A folded word to its sound form. Vowels fall to three classes (a: a/e,
 * e kept apart as the usual go-between, i: i/y, u: o/u) because romanisers disagree on them most; consonants
 * keep their identity apart from the hard merges (q/k/c, th/t, dh/d,
 * ph/f, ck/k). Digraphs become one capital symbol. Doubles collapse.
 */
export function soundForm(letters: string): string {
  let word = letters
    .replace(/^x/u, "z")
    .replace(/ph/gu, "f")
    .replace(/tch|ch/gu, "C")
    .replace(/sh/gu, "S")
    .replace(/kh/gu, "X")
    .replace(/gh/gu, "G")
    .replace(/th/gu, "t")
    .replace(/dh/gu, "d")
    .replace(/zh/gu, "j")
    .replace(/ck/gu, "k")
    .replace(/[qc]/gu, "k")
    .replace(/ou|oo|ow|aw/gu, "u")
    .replace(/ee|ie|ey|ay|ai|ei/gu, "i")
    .replace(/aa/gu, "a");
  // A final -ah / -eh / -a / -e is one ending: Qishtah, Qishta, Qishte.
  word = word.replace(/([aeiouy])h$/u, "$1").replace(/e$/u, "a");
  // An initial y before a vowel is a consonant (Yusuf); elsewhere a vowel.
  word = word.replace(/^y(?=[aeiou])/u, "Y");
  word = word
    .replace(/[iy]/gu, "i")
    .replace(/[ou]/gu, "u")
    .replace(/w(?![aeiu])/gu, "u");
  return word.replace(/(.)\1+/gu, "$1");
}

/**
 * Consonants a listener or recogniser swaps for one another, with the
 * cost of the swap (a hard substitution costs 1).
 */
const SOFT_PAIRS: readonly (readonly [string, string, number])[] = [
  ["k", "g", 0.3],
  ["k", "X", 0.35],
  ["X", "h", 0.3],
  ["X", "G", 0.3],
  ["G", "g", 0.2],
  ["s", "z", 0.3],
  ["s", "S", 0.4],
  ["S", "C", 0.35],
  ["j", "g", 0.45],
  ["j", "C", 0.45],
  ["j", "Y", 0.4],
  ["t", "d", 0.5],
  ["b", "p", 0.35],
  ["f", "v", 0.3],
  ["v", "w", 0.4],
  ["w", "u", 0.4],
  ["m", "n", 0.6],
  ["l", "r", 0.6],
];
const SOFT = new Map<string, number>();
for (const [a, b, cost] of SOFT_PAIRS) {
  SOFT.set(`${a}${b}`, cost);
  SOFT.set(`${b}${a}`, cost);
}

/** e sits between a and i (Ahmed/Ahmad, Khalid/Khaled); a, i, u do not. */
const VOWEL_SWAP: Readonly<Record<string, number>> = {
  ae: 0.3,
  ei: 0.3,
  eu: 0.5,
};
const VOWEL_GAP = 0.5;
/** A vowel the Arabic source never wrote costs little to find in Latin. */
const VOWEL_GAP_UNWRITTEN = 0.15;
/** An h that English speakers drop or add (Hassan/Assan). */
const H_GAP = 0.45;

function substitution(a: string, b: string): number {
  if (a === b) return 0;
  if (isVowel(a) && isVowel(b)) {
    return VOWEL_SWAP[[a, b].sort().join("")] ?? 1;
  }
  return SOFT.get(`${a}${b}`) ?? 1;
}

function gap(letter: string, unwritten: boolean): number {
  if (isVowel(letter)) return unwritten ? VOWEL_GAP_UNWRITTEN : VOWEL_GAP;
  if (letter === "h") return H_GAP;
  return 1;
}

/** How much a word weighs: a vowel counts for less than a consonant. */
const weight = (word: string): number =>
  [...word].reduce((sum, letter) => sum + (isVowel(letter) ? 0.6 : 1), 0);

/**
 * Similarity in [0,1] between two sound forms. `unwrittenVowels` is true
 * when either side came from Arabic script (vowels never written).
 */
export function soundSimilarity(
  a: string,
  b: string,
  unwrittenVowels: boolean,
): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  let previous: number[] = [0];
  for (let i = 1; i <= a.length; i += 1) {
    previous.push(
      (previous[i - 1] ?? 0) + gap(a[i - 1] ?? "", unwrittenVowels),
    );
  }
  for (let j = 1; j <= b.length; j += 1) {
    const bj = b[j - 1] ?? "";
    const row: number[] = [(previous[0] ?? 0) + gap(bj, unwrittenVowels)];
    for (let i = 1; i <= a.length; i += 1) {
      const ai = a[i - 1] ?? "";
      row.push(
        Math.min(
          (previous[i] ?? 0) + gap(bj, unwrittenVowels),
          (row[i - 1] ?? 0) + gap(ai, unwrittenVowels),
          (previous[i - 1] ?? 0) + substitution(ai, bj),
        ),
      );
    }
    previous = row;
  }
  const distance = previous[a.length] ?? Math.max(a.length, b.length);
  return Math.max(0, 1 - distance / Math.max(weight(a), weight(b)));
}
