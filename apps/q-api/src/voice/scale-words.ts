import { offeredLanguages } from "@capital-q/q-core/language";

/**
 * Scale words ("thousand", "million", "milliard") in every offered
 * language, from the runtime's own Intl compact-number data (owner
 * direction 2026-10-17: never a hand-written per-language list).
 *
 * Each language's compact long and short forms of 1, 2, 5 and 10 times a
 * thousand, a million and a billion are read back: the word left beside
 * the count is the scale, and its value is the figure divided by the count
 * ("10 लाख" for a million makes "लाख" a hundred thousand). A form of two
 * words ("mil millones") is left out rather than guessed. A word languages
 * give different values takes the value most of them give; a tie, none.
 */
export function intlScaleWords(): Readonly<Record<string, number>> {
  // Per word, how many languages give each value: the most common wins
  // ("mil" is a thousand in Spanish, Portuguese, Catalan and Galician).
  const votes = new Map<string, Map<number, number>>();
  const tags = new Set(["en", ...offeredLanguages().map((info) => info.tag)]);
  for (const tag of tags) {
    for (const display of ["long", "short"] as const) {
      let format: Intl.NumberFormat;
      try {
        format = new Intl.NumberFormat(tag, {
          notation: "compact",
          compactDisplay: display,
          numberingSystem: "latn",
        });
      } catch {
        continue;
      }
      for (const scale of [1e3, 1e6, 1e9]) {
        for (const count of [1, 2, 5, 10]) {
          const value = scale * count;
          const text = format.format(value).normalize("NFKC").toLowerCase();
          const digits = text.replace(/[^\d]/gu, "");
          const shown = digits.length === 0 ? 1 : Number(digits);
          const words = text.match(/[\p{L}\p{M}]+/gu) ?? [];
          if (words.length !== 1 || !Number.isFinite(shown) || shown === 0) {
            continue;
          }
          const word = words[0] ?? "";
          const unit = value / shown;
          // One letter is too easily a word of its own ("a"): never a scale.
          if (word.length < 2 || !Number.isInteger(unit) || unit < 100)
            continue;
          const byValue = votes.get(word) ?? new Map<number, number>();
          byValue.set(unit, (byValue.get(unit) ?? 0) + 1);
          votes.set(word, byValue);
        }
      }
    }
  }
  const found: Record<string, number> = {};
  for (const [word, byValue] of votes) {
    const ranked = [...byValue].sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    // A tie is ambiguous: left out rather than guessed.
    if (top !== undefined && (second === undefined || second[1] < top[1])) {
      found[word] = top[0];
    }
  }
  return found;
}

/**
 * Whether a language counts "two" apart (Intl plural rules): there, a
 * scale word with a short ending added is that scale twice over (Arabic
 * "مليوني" beside "مليون"; live AP).
 */
export function dualScaleOf(
  word: string,
  scales: Readonly<Record<string, number>>,
): number | null {
  for (const [scale, value] of Object.entries(scales)) {
    if (scale.length < 3 || !word.startsWith(scale)) continue;
    const extra = word.length - scale.length;
    if (extra >= 1 && extra <= 2 && DUAL_SCALE_WORDS.has(scale)) {
      return value * 2;
    }
  }
  return null;
}

/** Scale words of languages whose plural rules have a "two" category. */
const DUAL_SCALE_WORDS: ReadonlySet<string> = (() => {
  const words = new Set<string>();
  for (const info of offeredLanguages()) {
    let categories: readonly string[];
    try {
      categories = new Intl.PluralRules(info.tag).resolvedOptions()
        .pluralCategories;
    } catch {
      continue;
    }
    if (!categories.includes("two")) continue;
    let format: Intl.NumberFormat;
    try {
      format = new Intl.NumberFormat(info.tag, {
        notation: "compact",
        compactDisplay: "long",
        numberingSystem: "latn",
      });
    } catch {
      continue;
    }
    for (const value of [1e3, 1e6, 1e9]) {
      const word = (format
        .format(value)
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{M}]+/gu) ?? [])[0];
      if (word !== undefined && word.length >= 3) words.add(word);
    }
  }
  return words;
})();
