import {
  Q_SPOKEN_FORM_MAX_LENGTH,
  Q_SPOKEN_FORM_VERSION,
  type QSpokenForm,
} from "@capital-q/contracts";

/**
 * Phase 5 (owner directive 15 Nov 2026; audit RC3/RC7): one authoritative
 * Q result. The analyst writes a concise spoken form beside its full answer
 * in the same call, from the same evidence. The voice may say only what the
 * screen says: code keeps the spoken form only when every figure and every
 * name in it also appears in the full answer. A spoken form that adds one is
 * dropped (the voice then derives its words from the full answer, as
 * before), never repaired.
 *
 * Deterministic and conservative: a capitalised word counts as a name
 * unless it is a common sentence opener; a figure counts as the same figure
 * only when its value (after k/m/bn and thousands separators) is in the
 * answer.
 */

/** At most this many sentences are said for an analysis. */
export const SPOKEN_FORM_MAX_SENTENCES = 3;

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

const FIGURE =
  /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|bn|mn|k|m|b)?(?![\p{L}\d])/giu;

/** Every figure's value in the text, k/m/bn applied, separators removed. */
export function figureValuesOf(
  text: string,
  options: { readonly bare?: boolean } = {},
): ReadonlySet<string> {
  const values = new Set<string>();
  for (const match of text.matchAll(FIGURE)) {
    const raw = (match[1] ?? "").replace(/,/gu, "");
    const base = Number(raw);
    if (!Number.isFinite(base)) continue;
    const unit = match[2]?.toLowerCase();
    const multiplier = unit === undefined ? 1 : (MULTIPLIERS[unit] ?? 1);
    values.add(String(Math.round(base * multiplier * 1e6) / 1e6));
    // The answer's side also keeps the bare number ("4" of "$4m"), so a
    // spoken "4" meets it; a spoken figure is matched by its full value
    // only, so "4 billion" never passes on the "4" of "$4m".
    if (options.bare === true) values.add(String(base));
  }
  return values;
}

/**
 * Sentence openers and function words that are capitalised only because a
 * sentence starts with them. Not a list of facts: a word here can never
 * carry a name or a figure into the spoken form.
 */
const OPENERS: ReadonlySet<string> = new Set(
  [
    "a",
    "about",
    "after",
    "all",
    "also",
    "an",
    "and",
    "any",
    "as",
    "at",
    "because",
    "before",
    "both",
    "but",
    "by",
    "each",
    "either",
    "for",
    "from",
    "here",
    "here's",
    "how",
    "however",
    "i",
    "i'd",
    "i'll",
    "i'm",
    "i've",
    "if",
    "in",
    "it",
    "it's",
    "its",
    "just",
    "most",
    "my",
    "neither",
    "no",
    "none",
    "not",
    "nothing",
    "now",
    "of",
    "on",
    "one",
    "only",
    "or",
    "our",
    "overall",
    "so",
    "that",
    "that's",
    "the",
    "their",
    "then",
    "there",
    "there's",
    "these",
    "they",
    "they're",
    "this",
    "those",
    "to",
    "two",
    "three",
    "we",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "why",
    "with",
    "yes",
    "yet",
    "you",
    "you're",
    "your",
    "want",
    "would",
    "should",
    "could",
    "can",
    "do",
    "does",
    "is",
    "are",
    "was",
    "were",
    "let",
    "let's",
    "full",
    "details",
    "everything",
    "more",
    "see",
    "short",
  ].map((word) => word.toLowerCase()),
);

const WORD = /[\p{Lu}][\p{L}\p{M}'’.-]*/gu;

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/[^\p{L}\p{M}\d'-]+/gu, " ")} `;
}

/** Names in the spoken words: capitalised words that are not openers. */
export function namesOf(text: string): readonly string[] {
  const names: string[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0].replace(/[.'’-]+$/u, "");
    if (word.length === 0) continue;
    if (OPENERS.has(word.toLowerCase().replace(/[’]/gu, "'"))) continue;
    names.push(word);
  }
  return names;
}

/** What the spoken form says that the full answer does not. */
export function spokenOnlyFacts(
  spoken: string,
  answer: string,
): { readonly figures: readonly string[]; readonly names: readonly string[] } {
  const answerFigures = figureValuesOf(answer, { bare: true });
  const figures: string[] = [];
  for (const match of spoken.matchAll(FIGURE)) {
    const values = figureValuesOf(match[0]);
    if (![...values].some((value) => answerFigures.has(value))) {
      figures.push(match[0].trim());
    }
  }
  const answerWords = words(answer);
  const names = namesOf(spoken).filter(
    (name) =>
      !answerWords.includes(` ${name.toLowerCase().replace(/[’]/gu, "'")} `),
  );
  return { figures, names };
}

function sentencesOf(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => sentence.trim().length > 0).length;
}

/**
 * The spoken form to hand the voice, or null when there is none or it may
 * not be said: empty, too long, more than three sentences, markdown, or a
 * figure or name the full answer does not hold.
 */
export function spokenFormWithin(
  spoken: string | null | undefined,
  answer: string,
): QSpokenForm | null {
  if (spoken === null || spoken === undefined) return null;
  const text = spoken.replace(/\s+/gu, " ").trim();
  if (text.length === 0 || text.length > Q_SPOKEN_FORM_MAX_LENGTH) return null;
  if (/[*#|`]|^\s*[-•]\s/mu.test(text)) return null;
  if (sentencesOf(text) > SPOKEN_FORM_MAX_SENTENCES) return null;
  const extra = spokenOnlyFacts(text, answer);
  if (extra.figures.length > 0 || extra.names.length > 0) return null;
  return { version: Q_SPOKEN_FORM_VERSION, text };
}
