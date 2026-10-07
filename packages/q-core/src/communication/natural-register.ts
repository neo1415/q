/**
 * Q's natural register, checked and (narrowly) restored in code
 * (natural conversation, Zino live 2026-10-07;
 * docs/research/2026-10-07/natural-conversation.md §3.2).
 *
 * The prompt asks Q to talk like a senior analyst; this is the second
 * layer for the few frames that made the founder ask "is this how you
 * would talk to another human being?". Two parts:
 *
 * - `inFirstPerson` rewrites the bureaucratic third-person frames into
 *   the first person Q already speaks in. Register only: it never touches
 *   a claim, a number or a name, and a sentence it does not recognise is
 *   left exactly as written.
 * - `naturalRegisterIssues` names what still reads unnatural, for evals
 *   and logs. It never blocks an answer.
 */

type Rewrite = readonly [RegExp, string];

/** Each frame, and what a person says instead. Order matters. */
const REWRITES: readonly Rewrite[] = [
  [/\bCapital Q records that you have\b/giu, "you've"],
  [/\bCapital Q records that you\b/giu, "you"],
  [/\bCapital Q records show that\b/giu, "I can see that"],
  [/\bCapital Q(?:'s)? records show\b/giu, "I can see"],
  [/\bCapital Q records that\b/giu, "I have on record that"],
  [/\bCapital Q records\b/giu, "I have on record"],
  [/\baccording to Capital Q(?:'s records)?,?\s*/giu, ""],
  [/\bthe records? confirms? that\b/giu, "I can confirm that"],
  [/\bthe records? confirms?\b/giu, "I can confirm"],
  [/\bthe records show that\b/giu, "I can see that"],
  [/\bthe records show\b/giu, "I can see"],
];

function sentenceStartsAt(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return before.length === 0 || /[.!?:\n]$/u.test(before);
}

function capitalise(word: string): string {
  return word.length === 0
    ? word
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** The bureaucratic third-person frames, in Q's own first person. */
export function inFirstPerson(text: string): {
  readonly text: string;
  readonly rewritten: number;
} {
  let out = text;
  let rewritten = 0;
  for (const [pattern, replacement] of REWRITES) {
    out = out.replace(pattern, (_match: string, ...rest: unknown[]) => {
      const offset = rest.find((value) => typeof value === "number") ?? 0;
      rewritten += 1;
      if (replacement.length === 0) return "";
      // "I" is always upper case; anything else follows the sentence.
      if (replacement.startsWith("I ")) return replacement;
      return sentenceStartsAt(out, offset)
        ? capitalise(replacement)
        : replacement;
    });
  }
  // A removed lead-in leaves the next word lower case at a sentence start.
  if (rewritten > 0) {
    out = out.replace(
      /(^|[.!?]\s+)([a-z])/gu,
      (_m: string, lead: string, letter: string) =>
        `${lead}${letter.toUpperCase()}`,
    );
  }
  return { text: out, rewritten };
}

export const NATURAL_REGISTER_ISSUES = [
  "THIRD_PERSON_RECORDS",
  "REFLEX_OPENER",
  "FILLER_PHRASE",
  "ORPHAN_LIST_ITEM",
  "QUOTED_INTERNAL_TEXT",
  "TOO_LONG_TO_SAY",
  "LIST_READ_ALOUD",
  "REPEATED_DISCLAIMER",
] as const;
export type NaturalRegisterIssue = (typeof NATURAL_REGISTER_ISSUES)[number];

/** Spoken answers longer than this are a wall, not a turn. */
export const SPOKEN_WORDS_MAX = 60;

const CHECKS: readonly (readonly [NaturalRegisterIssue, RegExp])[] = [
  [
    "THIRD_PERSON_RECORDS",
    /\bCapital Q(?:'s)? records?\b|\bthe records? (?:confirms?|shows?)\b|\baccording to Capital Q\b/iu,
  ],
  [
    "REFLEX_OPENER",
    /^\s*(?:sure|got it|certainly|absolutely|great question|of course)\b[,.!]?/iu,
  ],
  [
    "FILLER_PHRASE",
    /\b(?:great question|I hope this helps|as an AI|happy to help|let me know if you have any other questions)\b/iu,
  ],
  ["ORPHAN_LIST_ITEM", /(?:^|[.!?]\s+|\n\s*[-*]?\s*)(?:Pros?|Cons?)\s*:/u],
  [
    "QUOTED_INTERNAL_TEXT",
    /"Please set this up|standing instruction for me:|\b(?:relationship|fit|company|companies|q|chat|approvals|schedule|investor_mandate|discovery|records)\.[a-z_]+(?:\.[a-z_]+)*\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/u,
  ],
];

/** What reads unnatural in an answer; empty when nothing does. */
export function naturalRegisterIssues(
  text: string,
  options: { readonly spoken?: boolean | undefined } = {},
): NaturalRegisterIssue[] {
  const issues: NaturalRegisterIssue[] = [];
  for (const [issue, pattern] of CHECKS) {
    if (pattern.test(text)) issues.push(issue);
  }
  if (options.spoken === true) {
    const words = text.trim().split(/\s+/u).filter(Boolean).length;
    if (words > SPOKEN_WORDS_MAX) issues.push("TOO_LONG_TO_SAY");
    if (/^\s*(?:[-*]|\d+\.)\s/mu.test(text)) issues.push("LIST_READ_ALOUD");
  }
  if (repeatedDisclaimers(text)) issues.push("REPEATED_DISCLAIMER");
  return issues;
}

/**
 * Boilerplate disclaimers, once at most (lead live replay 2026-10-07:
 * "this is mandate alignment—not an investment conclusion" alongside
 * "not an investment recommendation" and "a prioritisation for diligence
 * rather than a decision to invest" in one answer). The appended clause
 * form is always removed; a sentence that is only a disclaimer is kept
 * the first time and dropped after. A caveat about the evidence itself
 * ("round size isn't known yet") is not boilerplate and is never touched.
 */
const DISCLAIMER_CLAUSE =
  /\s*(?:[—–]|\s-\s|,|;|\()\s*(?:(?:this|that|which) is (?:only |just )?(?:mandate )?alignment,?\s*(?:and\s+)?)?not (?:an?|any) (?:investment |platform |final )?(?:recommendation|conclusion|verdict|decision|advice)\)?(?=[\s.,;!?]|$)/giu;
const ALIGNMENT_CLAUSE =
  /\s*(?:[—–]|\s-\s)\s*(?:this|that) is (?:only |just )?mandate alignment\b/giu;
const DISCLAIMER_SENTENCE =
  /\b(?:not (?:an?|any) (?:investment |platform |final )?(?:recommendation|conclusion|verdict|decision|advice)|rather than a (?:decision|recommendation|verdict) to invest|not a platform verdict|is an inference from)\b/iu;

function repeatedDisclaimers(text: string): boolean {
  const found = text.match(new RegExp(DISCLAIMER_SENTENCE.source, "giu"));
  return (found?.length ?? 0) > 1;
}

/** A per-answer guard: sentences in order, as they stream or are stored. */
export function createCaveatGuard() {
  let disclaimed = false;
  let removed = 0;
  return {
    sentence(sentence: string): string | null {
      const trimmed = sentence
        .replace(DISCLAIMER_CLAUSE, "")
        .replace(ALIGNMENT_CLAUSE, "");
      if (trimmed !== sentence) removed += 1;
      if (DISCLAIMER_SENTENCE.test(trimmed)) {
        if (disclaimed) {
          removed += 1;
          return null;
        }
        disclaimed = true;
      }
      return trimmed;
    },
    removed: () => removed,
  };
}

const CAVEAT_SENTENCE = /[^.!?\n]+(?:[.!?]+["”’)]*|\n|$)/gu;

/** The finished answer with at most one boilerplate disclaimer. */
export function withOneCaveat(text: string): {
  readonly text: string;
  readonly removed: number;
} {
  const guard = createCaveatGuard();
  const lines = text.split("\n").map((line) => {
    const parts = line.match(CAVEAT_SENTENCE) ?? [];
    if (parts.length === 0) return line;
    return parts
      .map((part) => {
        const lead = /^\s*/u.exec(part)?.[0] ?? "";
        const kept = guard.sentence(part.trim());
        return kept === null ? null : `${lead}${kept}`;
      })
      .filter((part): part is string => part !== null)
      .join("")
      .trimEnd();
  });
  return guard.removed() === 0
    ? { text, removed: 0 }
    : { text: lines.join("\n").trim(), removed: guard.removed() };
}
