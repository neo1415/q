/**
 * Code-written answers in any language (owner directive 2026-10-16: no
 * per-language hand work). An answer Q composes by code ("Here are three
 * investors who could fit: A, B and C.") is put into the person's language
 * through the same cached UI_TRANSLATION layer as the interface, sentence
 * by sentence, without its data: every name, figure, currency code, quote,
 * link and address is lifted out as a `{v1}` placeholder first, so what is
 * translated (and cached, and shared) is only the sentence's own words,
 * and what was recorded comes back exactly as it was.
 *
 * The cache key is the skeleton ("Here are {v1} investors who could fit:
 * {v2}, {v3} and {v4}."), which recurs across people and answers, so a
 * sentence is paid for once per language. A sentence with no translation
 * yet leaves the whole answer in English: never half one language.
 */

/** Product names the translator keeps as they are; never lifted out. */
const PRODUCT = /^(?:Capital Q|Q|GateQ|Q Pitch|The Q Daily|Q Daily|InvestIQ)$/u;

/**
 * Capitalised words that begin or sit in an ordinary sentence and are not a
 * name: translated, not lifted out. Anything else capitalised is kept as
 * recorded (at worst a word stays English; never a name is translated).
 */
const COMMON = new Set(
  `A An The I I'm I've I'll I'd It It's Its This That These Those There Here Here's There's
  You You're You've Your Yours We We're Our They They're Their He She His Her
  What What's Which Who Whom Whose Why How When Where Whether If So But And Or Nor
  Yes No None Nothing Nobody Something Someone Anything Everything Every Each All
  Some Any Many Most More Less Few Several Both Either Neither One Two Three Four
  Five Six Seven Eight Nine Ten First Second Third Next Last Then Also Still Only
  Just Not Never Always Already Now Today Tomorrow Yesterday Soon Later Before After
  Since Until While During From To For With Without About Above Below In On At By Of
  Up Down Out Over Under Again Once Twice Please Thanks Sorry Okay OK Done Ready
  Saved Sent Opened Opening Found Asked Waiting New Open Read Unread Ask Tell Show
  Let Try Shall Should Would Could Can Will May Might Must Do Does Did Is Are Was
  Were Be Been Being Has Have Had Get Got Make Made Take See Seen Say Said Go Going
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March
  April May June July August September October November December Jan Feb Mar Apr
  Jun Jul Aug Sep Sept Oct Nov Dec`.split(/\s+/u),
);

const LIFT = new RegExp(
  [
    // A markdown link, a URL, an email address.
    String.raw`\[[^\]\n]+\]\([^)\s]+\)`,
    String.raw`https?:\/\/[^\s)]+`,
    String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
    // What someone wrote, quoted.
    String.raw`"[^"\n]+"`,
    String.raw`“[^”\n]+”`,
    String.raw`«[^»\n]+»`,
    // A figure: digits with their separators, a currency sign before and a
    // unit glued after (12.6, $20, 1.5m, 30%, 2x, 10:30).
    String.raw`[$€£¥₦]?\d(?:[\d,.:/]*\d)?(?:%|k|m|bn|x|st|nd|rd|th)?(?![\p{L}\d])`,
    // A run of capitalised words: a name (Rimal Freight, AlRayan Investment
    // LLC, Bank of Kigali), an acronym (SAFE, AED), a handle (@zino).
    String.raw`@[\w.]+`,
    // A full stop belongs to a name only inside it ("U.S."), so a name
    // never runs on into the next sentence.
    String.raw`[\p{Lu}](?:[\p{L}\p{N}'’&\-]|\.(?=\p{L}))*(?:\s+(?:(?:of|de|del|da|al|el|bin|van|von|&)\s+)?[\p{Lu}(](?:[\p{L}\p{N}'’&\-)]|\.(?=\p{L}))*)*`,
  ].join("|"),
  "gu",
);

const PLACEHOLDER = /\{v(\d+)\}/gu;

export type Skeleton = {
  /** The sentence's own words, with `{v1}`… where its data was. */
  readonly skeleton: string;
  /** What each placeholder stands for, in order. */
  readonly values: readonly string[];
};

function lift(text: string): {
  readonly body: string;
  readonly values: string[];
} {
  const values: string[] = [];
  let first = true;
  const body = text.replace(LIFT, (found, offset: number) => {
    const before = text.slice(0, offset);
    // A sentence's first word is a name only when it is not an ordinary word.
    const atStart = first && /^[\s*_>#\-•\d.)]*$/u.test(before);
    first = false;
    const word = found.split(/\s+/u)[0] ?? found;
    if (/^\p{Lu}/u.test(found)) {
      if (PRODUCT.test(found)) return found;
      const single = !/\s/u.test(found);
      const ordinary = COMMON.has(word.replace(/[.'’]+$/u, ""));
      if (single && ordinary) return found;
      // "Here Rimal Freight": an ordinary first word before a name.
      if (ordinary && atStart) {
        const rest = found.slice(word.length).trimStart();
        if (rest.length > 0 && !COMMON.has(rest.split(/\s+/u)[0] ?? "")) {
          values.push(rest);
          return `${word} {v${String(values.length)}}`;
        }
        return found;
      }
    }
    values.push(found);
    return `{v${String(values.length)}}`;
  });
  return { body, values };
}

/** Sentences of one line, split after . ! ? … (figures are lifted first). */
function sentencesOf(line: string): readonly string[] {
  return line.split(/(?<=[.!?…])\s+(?=\S)/u).filter((s) => s.length > 0);
}

/** One sentence's skeleton, with its placeholders numbered from 1. */
function renumbered(sentence: string, all: readonly string[]): Skeleton {
  const values: string[] = [];
  const skeleton = sentence.replace(PLACEHOLDER, (_, n: string) => {
    values.push(all[Number(n) - 1] ?? "");
    return `{v${String(values.length)}}`;
  });
  return { skeleton, values };
}

type Part =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "SENTENCE"; readonly sentence: Skeleton };

/** The answer as lines of literal prefixes and translatable sentences. */
function partsOf(text: string): readonly (readonly Part[])[] {
  return text.split("\n").map((line) => {
    const prefix =
      /^\s*(?:[-*•]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?/u.exec(line)?.[0] ?? "";
    const rest = line.slice(prefix.length);
    if (rest.trim().length === 0) return [{ kind: "TEXT", text: line }];
    const lifted = lift(rest);
    const parts: Part[] =
      prefix.length > 0 ? [{ kind: "TEXT", text: prefix }] : [];
    sentencesOf(lifted.body).forEach((sentence, i) => {
      if (i > 0) parts.push({ kind: "TEXT", text: " " });
      const one = renumbered(sentence, lifted.values);
      // Nothing to translate (only data and punctuation): kept as it is.
      parts.push(
        /\p{L}/u.test(one.skeleton.replace(PLACEHOLDER, ""))
          ? { kind: "SENTENCE", sentence: one }
          : { kind: "TEXT", text: fill(one.skeleton, one.values) },
      );
    });
    return parts;
  });
}

/** The skeletons an answer needs translated, each once. */
export function answerSkeletons(text: string): readonly string[] {
  const out = new Set<string>();
  for (const line of partsOf(text)) {
    for (const part of line) {
      if (part.kind === "SENTENCE") out.add(part.sentence.skeleton);
    }
  }
  return [...out];
}

function fill(skeleton: string, values: readonly string[]): string {
  return skeleton.replace(
    PLACEHOLDER,
    (whole, n: string) => values[Number(n) - 1] ?? whole,
  );
}

/**
 * The answer with each sentence's words from `translated` and its data put
 * back exactly; null when any sentence has no translation (the English
 * then stands as it is).
 */
export function localisedAnswer(
  text: string,
  translated: ReadonlyMap<string, string>,
): string | null {
  const lines: string[] = [];
  for (const line of partsOf(text)) {
    let out = "";
    for (const part of line) {
      if (part.kind === "TEXT") {
        out += part.text;
        continue;
      }
      const words = translated.get(part.sentence.skeleton);
      if (words === undefined) return null;
      out += fill(words, part.sentence.values);
    }
    lines.push(out);
  }
  return lines.join("\n");
}

/** The skeleton of one short string (a card title, a chip), for tests and callers. */
export function skeletonOf(text: string): Skeleton {
  const lifted = lift(text);
  return renumbered(lifted.body, lifted.values);
}
