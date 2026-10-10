import { tokenize } from "./tokens.js";

/**
 * Proper-name intelligence, step 8: how a name is SAID. Pronunciations are
 * only ever supplied, never derived: Q does not infer an Arabic
 * pronunciation from a spelling and call it verified. Two things exist:
 *
 *  - a VERIFIED guide: from a named source (the person's own recording or
 *    profile, a publisher's guide). `verified` is true only with a source;
 *  - a USER correction ("it's pronounced KISH-ta", "the name is spelled
 *    Qishta"): the asker's own word, kept for them (or their organisation)
 *    and labelled as theirs, never as verified.
 *
 * Both are scoped (a user, or an organisation) and key to the NAME ENTITY:
 * Qishta, Kishta and Qeshta share one key, so a correction made under one
 * spelling serves them all.
 */

export type PronunciationSource =
  "VERIFIED_GUIDE" | "PERSON_STATED" | "USER_CORRECTION";

export type PronunciationKind = "pronunciation" | "spelling";

export type NamePronunciation = {
  readonly nameKey: string;
  readonly displayName: string;
  readonly kind: PronunciationKind;
  /** How to say it (a respelling such as "KISH-tah"), or the spelling. */
  readonly value: string;
  readonly source: PronunciationSource;
  /** Where a verified guide came from; required for VERIFIED_GUIDE. */
  readonly sourceRef: string | null;
};

/** Verified means attributed to a source other than the asker's say-so. */
export const isVerifiedPronunciation = (p: NamePronunciation): boolean =>
  (p.source === "VERIFIED_GUIDE" &&
    p.sourceRef !== null &&
    p.sourceRef.length > 0) ||
  p.source === "PERSON_STATED";

/**
 * The key of a name entity: its words' primary sound forms, in order, so
 * every romanisation of the same name has the same key.
 */
export function nameKeyOf(name: string): string {
  return (
    tokenize(name)
      // e and a are the romanisers' coin-toss (Mohamed/Muhammad).
      .map((token) => (token.forms[0] ?? "").replace(/e/gu, "a"))
      .filter((form) => form.length > 0)
      .join(" ")
  );
}

export type NameCorrection = {
  readonly kind: PronunciationKind;
  /** The name it is about when the sentence says it; else the caller's focus. */
  readonly name: string | null;
  readonly value: string;
};

const VALUE = '["“”\']?([^"“”.!?\\n]{2,60}?)["“”\']?\\s*[.!?]*$';
const NAME = "([\\p{L}\\p{M}'’ -]{2,60}?)";

/**
 * "It's pronounced KISH-ta", "Qishta is pronounced like kish-tah", "the
 * name is spelled Q-I-S-H-T-A" to a correction; null when the sentence is
 * neither. Pure parsing: it checks nothing about whether the value is right.
 */
export function parseNameCorrection(text: string): NameCorrection | null {
  const clean = text.trim();
  const named = new RegExp(
    `^${NAME}\\s+(?:is|was)\\s+(pronounced|said|spelled|spelt|written)\\s+(?:like\\s+|as\\s+)?${VALUE}`,
    "iu",
  ).exec(clean);
  const bare = new RegExp(
    `^(?:no[,.]?\\s+|actually[,.]?\\s+)?(?:it['’]?s|it is|that['’]?s|the name is|his name is|her name is|the correct (?:pronunciation|spelling) is)\\s+(pronounced|said|spelled|spelt|written)\\s+(?:like\\s+|as\\s+)?${VALUE}`,
    "iu",
  ).exec(clean);
  const say = new RegExp(
    `^(?:please\\s+)?say\\s+${NAME}\\s+(?:like|as)\\s+${VALUE}`,
    "iu",
  ).exec(clean);
  const match = named ?? say ?? bare;
  if (match === null) return null;
  let name: string | null = null;
  let verb: string;
  let value: string;
  if (named !== null) {
    name = named[1]?.trim() ?? null;
    verb = named[2] ?? "";
    value = named[3] ?? "";
  } else if (say !== null) {
    name = say[1]?.trim() ?? null;
    verb = "pronounced";
    value = say[2] ?? "";
  } else {
    verb = bare?.[1] ?? "";
    value = bare?.[2] ?? "";
  }
  const kind: PronunciationKind = /^(spelled|spelt|written)$/iu.test(verb)
    ? "spelling"
    : "pronunciation";
  value = value.trim();
  // "I can't say" style filler or an empty value is not a correction.
  if (
    value.length < 2 ||
    /^(?:wrong|different|not|incorrect)\b/iu.test(value)
  ) {
    return null;
  }
  if (
    name !== null &&
    /^(it|that|this|the name|his name|her name)$/iu.test(name)
  ) {
    name = null;
  }
  return {
    kind,
    name,
    value: kind === "spelling" ? value.replace(/\s*-\s*/gu, "") : value,
  };
}

const LINE_MAX = 120;
export const PRONUNCIATION_HINTS_MAX = 8;

/**
 * The hint lines GPT-Live gets with its session context. Verified guides
 * say so; a user's correction says it is theirs. Spellings tell the voice
 * how the name is written. Bounded, one line each, data not instruction.
 */
export function pronunciationHintLines(
  all: readonly NamePronunciation[],
): readonly string[] {
  const rank = (p: NamePronunciation): number =>
    isVerifiedPronunciation(p) ? 0 : 1;
  return [...all]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, PRONUNCIATION_HINTS_MAX)
    .map((p) => {
      const how =
        p.kind === "spelling"
          ? `is written "${p.value}"`
          : `is said "${p.value}"`;
      const who = isVerifiedPronunciation(p)
        ? "verified"
        : "as the user told Q";
      return `${p.displayName} ${how} (${who})`.slice(0, LINE_MAX);
    });
}
