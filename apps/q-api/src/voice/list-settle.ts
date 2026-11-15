import type { OnboardingResponseValue } from "@capital-q/contracts";
import {
  INVESTOR_CONCEPT_FAMILIES,
  INVESTOR_LIST_THEMES,
  INVESTOR_NONE_STEPS,
  type InvestorListTheme,
} from "@capital-q/investor-onboarding";
import { isNoneAnswer, NONE_ANSWER_TEXT } from "@capital-q/onboarding";

import { plainStepLabel } from "./step-copy.js";

/**
 * The investor lists an explicit answer settles (e2e run 4, 2026-11-07;
 * owner: "ask the lists in as few natural questions as possible; never a
 * 10-question form", and never re-ask a concept already answered).
 *
 * Unknown stays unknown (CLAUDE.md): a list their answer did not touch is
 * never turned into "None". Only an explicit answer settles a list:
 *
 * 1. A plain whole "none" to a themed question Q asked (the theme's own
 *    words, or its follow-up's) is "None" for every list it asked that is
 *    still open: they answered all of them at once. A plain "none" to a
 *    question about one list (the step Q's line asked, e2e run 5: "Are
 *    there sectors you'd rather not see?" answered "None." seven times and
 *    never saved) is "None" for that list, and, when it is one of a
 *    concept family, for the family's open lists too.
 * 2. A plain skip ("not sure", "skip") to a themed question, its follow-up
 *    or a one-list question is "I don't know" for the lists it asked: a
 *    skip is accepted once and not asked again (DECISIONS 78/79).
 * 3. "None" recorded this turn for one list of a concept family (what they
 *    do not want to see) is "None" for the family's other open lists: an
 *    explicit none on the same concept.
 *
 * An answer that fills some lists of a theme records only those (the
 * reading's job); the rest stay open and Q asks once, briefly, about just
 * those (`themeFollowUp`). Only required lists "None" answers
 * (INVESTOR_NONE_STEPS) are returned, and only open ones: an answer on the
 * record is never replaced. Code decides from the record and from what Q
 * asked, never from a reading of meaning.
 */

/** A reply that is "none" and nothing else. */
const WHOLE_NONE = new Set([
  "none",
  "no",
  "nope",
  "nothing",
  "none really",
  "nothing really",
  "not really",
  "none at all",
  "nothing at all",
  "none of those",
  "none of them",
  "no preference",
  "no preferences",
  "no preference really",
  "no restrictions",
  "nothing comes to mind",
  "no thanks",
  // e2e run 7: the natural nones for the own-words lists (anything else
  // they look for, their portfolio) -- explicit answers, not refusals:
  // "No, that's everything." five times and "None yet." twice, unsaved.
  "that's everything",
  "no that's everything",
  "that's it",
  "no that's it",
  "that's all",
  "no that's all",
  "nothing else",
  "no nothing else",
  "nothing more",
  "no nothing more",
  "nothing to add",
  "no nothing to add",
  "nothing further",
  "none yet",
  "no none yet",
  "not yet",
  "no not yet",
  "nothing yet",
  "no portfolio yet",
  "no portfolio companies yet",
  "no investments yet",
  "no companies yet",
  NONE_ANSWER_TEXT.toLowerCase(),
]);

/** A reply that declines and says nothing else. */
const WHOLE_SKIP = new Set([
  "skip",
  "skip it",
  "skip that",
  "pass",
  "next",
  "not sure",
  "i'm not sure",
  "im not sure",
  "don't know",
  "i don't know",
  "dont know",
  "i dont know",
  "no idea",
  "dunno",
  "rather not say",
  "i'd rather not say",
  "id rather not say",
  "rather not answer",
  "i'd rather not answer",
  "id rather not answer",
  "i'd rather not answer that",
  "i'll pass",
  "ill pass",
  "not now",
  "maybe later",
]);

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

/** Words that turn a "none" into a partial answer ("none, except …"). */
const EXCEPTION_WORDS =
  /\b(?:except|but|apart|other than|beyond|besides|only|although|though|unless|however)\b/u;

/** A reason that a none is a new fund's ("it's a new fund", "first fund"). */
const NEW_FUND_REASON = /\b(?:new|first|fresh|just|launch\w*|start\w*)\b/u;

export function isWholeNone(utterance: string): boolean {
  if (WHOLE_NONE.has(plain(utterance))) return true;
  // Live 2026-11-15 D1: "None yet, it's a new fund." to the portfolio
  // question was refused. A whole none, then only its reason in a clause
  // of its own: a "yet" none, or any none with a new-fund reason. A clause
  // that names an exception or anything else is the reading's.
  const [head, ...rest] = utterance.split(/[,.;:!—–]+/u);
  const tail = plain(rest.join(" "));
  const first = plain(head ?? "");
  if (tail.length === 0 || !WHOLE_NONE.has(first)) return false;
  if (EXCEPTION_WORDS.test(tail) || tail.split(" ").length > 8) return false;
  return /\byet\b/u.test(first) || NEW_FUND_REASON.test(tail);
}

/**
 * "I'd rather skip that one", "Skip that one for now", "Let's skip it":
 * a skip and nothing else (live 2026-11-15 D1: both were missed).
 */
const SKIP_PHRASE =
  /^(?:(?:can we|could we|let's|lets|i'd|id|i would|i'll|ill|i will|i want to|i'd like to|i prefer to|please)\s+)?(?:rather\s+|like to\s+|prefer to\s+)?(?:just\s+)?(?:skip|pass on)(?:\s+(?:it|that|this|that one|this one|this question|that question|that bit|this bit))?(?:\s+for now)?(?:\s+please)?(?:\s+thanks)?$/u;

export function isWholeSkip(utterance: string): boolean {
  const said = plain(utterance);
  return WHOLE_SKIP.has(said) || SKIP_PHRASE.test(said);
}

/**
 * "None beyond crypto." to "Beyond speculative crypto, what's off the
 * table for you …?" (live 2026-11-15 D3: the lists stayed open and the
 * exclusions came back as a garbled re-ask): a none whose exception is
 * only what Q's own line already named. Any other exception is content,
 * the reading's.
 */
const NONE_BEYOND =
  /^(?:none|nothing|no|no others?|nothing else|none else|nothing more)\s+(?:beyond|besides|other than|apart from|except(?: for)?|but)\s+(.+)$/u;

export function noneBeyondWhatQSaid(
  utterance: string,
  lastQTurn: string | null | undefined,
): boolean {
  const match = NONE_BEYOND.exec(plain(utterance));
  const named = match?.[1];
  if (named === undefined || lastQTurn === null || lastQTurn === undefined) {
    return false;
  }
  const qWords = new Set(plain(lastQTurn).split(" "));
  const words = named
    .split(" ")
    .filter((word) => !["the", "a", "an", "that", "this", "it"].includes(word));
  return words.length > 0 && words.every((word) => qWords.has(word));
}

/**
 * A list as a follow-up names it. The profile's labels overlap ("Sectors
 * you'd rather not see", "Rather not see"), and the follow-up read "sectors
 * you'd rather not see, rather not see or excluded sectors" (live
 * 2026-11-15 D3).
 */
const FOLLOW_UP_LABELS: Readonly<Record<string, string>> = {
  "I7.avoid": "anything else you'd rather not see",
  "I7.sector_exclusions": "sectors to exclude outright",
};

function followUpLabel(stepKey: string): string {
  return FOLLOW_UP_LABELS[stepKey] ?? plainStepLabel(stepKey).toLowerCase();
}

/** The words that open a theme's question, up to its colon. */
function cueOf(theme: InvestorListTheme): string {
  const head = theme.question.split(":")[0] ?? theme.question;
  return plain(head);
}

const FOLLOW_UP_HEAD = "Anything on";

/**
 * The one short follow-up about a theme's lists an answer left open
 * ("Anything on revenue expectations or regulated markets, or no
 * preference?"), in the lists' own plain labels.
 */
export function themeFollowUp(openStepKeys: readonly string[]): string {
  const labels = openStepKeys.map(followUpLabel);
  const named =
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1) ?? ""}`;
  return `${FOLLOW_UP_HEAD} ${named}, or no preference?`;
}

export type AskedTheme = {
  readonly theme: InvestorListTheme;
  /** The follow-up about some of its lists, or the theme's own question. */
  readonly followUp: boolean;
  /** The lists that question asked. */
  readonly stepKeys: readonly string[];
};

/** The theme Q's last turn asked, by its own words; undefined: none. */
export function themeAskedIn(
  lastQTurn: string | null | undefined,
): AskedTheme | undefined {
  if (lastQTurn === null || lastQTurn === undefined) return undefined;
  const said = plain(lastQTurn);
  for (const theme of INVESTOR_LIST_THEMES) {
    if (said.includes(cueOf(theme))) {
      return { theme, followUp: false, stepKeys: theme.stepKeys };
    }
  }
  if (!said.includes(plain(FOLLOW_UP_HEAD))) return undefined;
  for (const theme of INVESTOR_LIST_THEMES) {
    const named = theme.stepKeys.filter((key) =>
      said.includes(plain(followUpLabel(key))),
    );
    if (named.length > 0) return { theme, followUp: true, stepKeys: named };
  }
  return undefined;
}

export type SettledLists = {
  /** Explicitly none: recorded "None". */
  readonly none: readonly string[];
  /** Skipped when asked again: recorded as not known. */
  readonly notKnown: readonly string[];
};

export function listsSettledByAnswer(input: {
  readonly lastQTurn: string | null | undefined;
  /** The step Q's last line asked, when known. */
  readonly askedStep?: string | null | undefined;
  readonly utterance: string;
  /** Steps written this turn. */
  readonly recordedThisTurn: readonly string[];
  /** Every step on their path that is still open (no answer). */
  readonly open: ReadonlySet<string>;
  /** What the record holds now, by step. */
  readonly answers: ReadonlyMap<string, OnboardingResponseValue>;
}): SettledLists {
  const none = new Set<string>();
  const notKnown = new Set<string>();
  const asked = themeAskedIn(input.lastQTurn);
  if (
    asked !== undefined &&
    (isWholeNone(input.utterance) ||
      noneBeyondWhatQSaid(input.utterance, input.lastQTurn))
  ) {
    for (const key of asked.stepKeys) none.add(key);
  } else if (asked !== undefined && isWholeSkip(input.utterance)) {
    // A skip is accepted the first time and never asked again (DECISIONS
    // 78/79; live 2026-11-15 D1: a skipped "company fit" question was
    // called "needed" and came back two turns later): not known.
    for (const key of asked.stepKeys) notKnown.add(key);
  }
  const askedStep = input.askedStep ?? undefined;
  if (askedStep !== undefined && INVESTOR_NONE_STEPS.has(askedStep)) {
    if (isWholeNone(input.utterance)) none.add(askedStep);
    else if (isWholeSkip(input.utterance)) notKnown.add(askedStep);
  }
  for (const family of INVESTOR_CONCEPT_FAMILIES) {
    const saidNone = family.stepKeys.some(
      (key) =>
        (input.recordedThisTurn.includes(key) &&
          isNoneAnswer(input.answers.get(key))) ||
        (key === askedStep && none.has(key)),
    );
    if (saidNone) for (const key of family.stepKeys) none.add(key);
  }
  const settles = (key: string) =>
    INVESTOR_NONE_STEPS.has(key) && input.open.has(key);
  return {
    none: [...none].filter(settles),
    notKnown: [...notKnown].filter((key) => settles(key) && !none.has(key)),
  };
}
