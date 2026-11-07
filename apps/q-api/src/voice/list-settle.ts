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
 *    still open: they answered all of them at once.
 * 2. A plain skip ("not sure", "skip") to the follow-up is "I don't know"
 *    for the lists it named: asked twice, and they would rather not say.
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
]);

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

export function isWholeNone(utterance: string): boolean {
  return WHOLE_NONE.has(plain(utterance));
}

export function isWholeSkip(utterance: string): boolean {
  return WHOLE_SKIP.has(plain(utterance));
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
  const labels = openStepKeys.map((key) => plainStepLabel(key).toLowerCase());
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
      said.includes(plain(plainStepLabel(key))),
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
  if (asked !== undefined && isWholeNone(input.utterance)) {
    for (const key of asked.stepKeys) none.add(key);
  } else if (asked?.followUp === true && isWholeSkip(input.utterance)) {
    for (const key of asked.stepKeys) notKnown.add(key);
  }
  for (const family of INVESTOR_CONCEPT_FAMILIES) {
    const saidNone = family.stepKeys.some(
      (key) =>
        input.recordedThisTurn.includes(key) &&
        isNoneAnswer(input.answers.get(key)),
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
