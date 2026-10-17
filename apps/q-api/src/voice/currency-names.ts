import { offeredLanguages } from "@capital-q/q-core/language";

/**
 * Currency names in every language the platform offers, from the
 * runtime's own Intl data (owner direction 2026-10-17: no hand-written
 * per-language word lists). Built once, on first use.
 *
 * For each ISO code: its full names in every language ("US Dollar",
 * "دولار أمريكي", "dollar des États-Unis"), and its unit words: the words of
 * a name shared by at least two currencies in that language ("dollar",
 * "دولار", "rupee"), which name the unit but not which country's.
 */
type CurrencyWords = {
  readonly names: ReadonlySet<string>;
  readonly units: ReadonlySet<string>;
  /** Words of its names no other currency's name has in that language ("naira"). */
  readonly own: ReadonlySet<string>;
};

let VOCABULARY: ReadonlyMap<string, CurrencyWords> | null = null;

export function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

function vocabulary(): ReadonlyMap<string, CurrencyWords> {
  if (VOCABULARY !== null) return VOCABULARY;
  const codes = Intl.supportedValuesOf("currency");
  const names = new Map<string, Set<string>>();
  const units = new Map<string, Set<string>>();
  const own = new Map<string, Set<string>>();
  for (const code of codes) {
    names.set(code, new Set());
    units.set(code, new Set());
    own.set(code, new Set());
  }
  const tags = ["en", ...offeredLanguages().map((info) => info.tag)];
  for (const tag of new Set(tags)) {
    let display: Intl.DisplayNames;
    try {
      display = new Intl.DisplayNames([tag], {
        type: "currency",
        fallback: "none",
      });
    } catch {
      continue;
    }
    const byCode = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const code of codes) {
      const name = display.of(code);
      if (name === undefined || name.toUpperCase() === code) continue;
      const words = wordsOf(name);
      if (words.length === 0) continue;
      byCode.set(code, words);
      names.get(code)?.add(words.join(" "));
      for (const word of new Set(words)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
    for (const [code, words] of byCode) {
      for (const word of words) {
        if ((counts.get(word) ?? 0) >= 2 && word.length >= 3) {
          units.get(code)?.add(word);
        } else if ((counts.get(word) ?? 0) === 1 && word.length >= 4) {
          own.get(code)?.add(word);
        }
      }
    }
  }
  VOCABULARY = new Map(
    codes.map((code) => [
      code,
      {
        names: names.get(code) ?? new Set<string>(),
        units: units.get(code) ?? new Set<string>(),
        own: own.get(code) ?? new Set<string>(),
      },
    ]),
  );
  return VOCABULARY;
}

/** A word of theirs that is the unit word, inflected or with an attached particle. */
function carriesUnit(word: string, unit: string): boolean {
  if (word === unit) return true;
  // An inflected ending ("रुपये" for "रुपया"): the same word but for its
  // last letter.
  if (
    // Five letters or more, one letter apart at most: "Europe" is not
    // "euro".
    unit.length >= 5 &&
    Math.abs(word.length - unit.length) <= 1 &&
    word.slice(0, unit.length - 1) === unit.slice(0, unit.length - 1)
  ) {
    return true;
  }
  if (word.startsWith(unit) && word.length <= unit.length + 2) return true;
  return word.endsWith(unit) && word.length <= unit.length + 3;
}

/**
 * The currency their words name, among `offered` ISO codes:
 * - a full name in any language names exactly that currency; a full name
 *   of a currency not offered ("dollar canadien") means none of these;
 * - otherwise a unit word ("dollars", "بالدولار") names the offered
 *   currencies that share it: one is that one; several are told apart by
 *   `context` (the country they gave) or, for the dollar alone, read as the
 *   US dollar (owner 2026-10-16); any other tie is left for Q to ask.
 */
/** An ISO code, several, a currency not offered, or none named. */
export type CurrencyInWords =
  | { readonly kind: "ONE"; readonly code: string }
  | { readonly kind: "SEVERAL" }
  | { readonly kind: "OTHER" }
  | null;

export function currencyInWords(
  text: string,
  offered: readonly string[],
  context: { readonly countryCode?: string | null } = {},
): CurrencyInWords {
  const vocabularyNow = vocabulary();
  const words = wordsOf(text);
  const offeredSet = new Set(offered.map((code) => code.toUpperCase()));
  const full = new Set<string>();
  for (const [code, entry] of vocabularyNow) {
    for (const name of entry.names) {
      const parts = name.split(" ");
      const named = name.includes(" ")
        ? // Every word of the name, in order, plurals and particles aside.
          words.some((_, start) =>
            parts.every((part, i) => {
              const word = words[start + i];
              return word !== undefined && carriesUnit(word, part);
            }),
          )
        : // A one-word name ("euro", "يورو") that is not a shared unit word.
          !entry.units.has(name) &&
          name.length >= 3 &&
          words.some((word) => carriesUnit(word, name));
      if (named) full.add(code);
    }
  }
  const offeredFull = [...full].filter((code) => offeredSet.has(code));
  // A currency not offered, named in full ("dollar canadien"): none of these.
  if (full.size > 0 && offeredFull.length === 0) return { kind: "OTHER" };
  const has = (unit: string) => words.some((word) => carriesUnit(word, unit));
  const byOwnWord = [...offeredSet].filter((code) =>
    [...(vocabularyNow.get(code)?.own ?? [])].some(has),
  );
  const named = new Set([...offeredFull, ...byOwnWord]);
  const byUnit = [...offeredSet].filter((code) =>
    [...(vocabularyNow.get(code)?.units ?? [])].some(has),
  );
  // A unit word their words carry that none of the named currencies has
  // is another currency again ("part euros, part dirhams").
  const unitsOfNamed = new Set(
    [...named].flatMap((code) => [...(vocabularyNow.get(code)?.units ?? [])]),
  );
  const otherUnit = byUnit.some(
    (code) =>
      !named.has(code) &&
      [...(vocabularyNow.get(code)?.units ?? [])].some(
        (unit) => has(unit) && !unitsOfNamed.has(unit),
      ),
  );
  if (named.size > 1 || (named.size === 1 && otherUnit)) {
    return { kind: "SEVERAL" };
  }
  const only = [...named][0];
  if (only !== undefined) return { kind: "ONE", code: only };
  const single = byUnit.length === 1 ? byUnit[0] : undefined;
  if (single !== undefined) return { kind: "ONE", code: single };
  if (byUnit.length === 0) return null;
  const country = context.countryCode?.toUpperCase() ?? null;
  if (country !== null) {
    // The currency of the country they gave, when it is one of the tied.
    const local = byUnit.find((code) => code.startsWith(country));
    if (local !== undefined) return { kind: "ONE", code: local };
  }
  if (byUnit.includes("USD")) return { kind: "ONE", code: "USD" };
  return { kind: "SEVERAL" };
}
