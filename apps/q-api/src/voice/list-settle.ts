import {
  INVESTOR_CONCEPT_FAMILIES,
  INVESTOR_LIST_THEMES,
  INVESTOR_NONE_STEPS,
  type InvestorListTheme,
} from "@capital-q/investor-onboarding";
import type { OnboardingResponseValue } from "@capital-q/contracts";
import { isNoneAnswer, NONE_ANSWER_TEXT } from "@capital-q/onboarding";

/**
 * The investor lists an answer settles by itself (e2e run 4, 2026-11-07;
 * owner: "ask the lists in as few natural questions as possible; never a
 * 10-question form", and never re-ask a concept already answered).
 *
 * Code decides, from the record and from what Q asked, never from a
 * reading of meaning:
 *
 * 1. A themed question Q asked (its words are in Q's last turn) that their
 *    reply answered -- some list of the theme was recorded this turn, or
 *    the whole reply is a plain "none" -- settles the theme: every list of
 *    it still open was asked and has nothing for them, so it is "None".
 * 2. "None" recorded this turn for one list of a concept family (what they
 *    do not want to see) is "None" for the family's other open lists: one
 *    concept, one answer.
 *
 * Only required lists "None" answers (INVESTOR_NONE_STEPS) are returned,
 * and only open ones: an answer on the record is never replaced. The
 * review shows every list for them to change before they finish.
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

/** The words that open a theme's question, up to its colon. */
function cueOf(theme: InvestorListTheme): string {
  const head = theme.question.split(":")[0] ?? theme.question;
  return plain(head);
}

/** The theme Q's last turn asked, by its own words; undefined: none. */
export function themeAskedIn(
  lastQTurn: string | null | undefined,
): InvestorListTheme | undefined {
  if (lastQTurn === null || lastQTurn === undefined) return undefined;
  const said = plain(lastQTurn);
  return INVESTOR_LIST_THEMES.find((theme) => said.includes(cueOf(theme)));
}

export function listsSettledByAnswer(input: {
  readonly lastQTurn: string | null | undefined;
  readonly utterance: string;
  /** Steps written this turn. */
  readonly recordedThisTurn: readonly string[];
  /** Every step on their path that is still open (no answer). */
  readonly open: ReadonlySet<string>;
  /** What the record holds now, by step. */
  readonly answers: ReadonlyMap<string, OnboardingResponseValue>;
}): string[] {
  const settle = new Set<string>();
  const theme = themeAskedIn(input.lastQTurn);
  if (
    theme !== undefined &&
    (isWholeNone(input.utterance) ||
      theme.stepKeys.some((key) => input.recordedThisTurn.includes(key)))
  ) {
    for (const key of theme.stepKeys) settle.add(key);
  }
  for (const family of INVESTOR_CONCEPT_FAMILIES) {
    const saidNone = family.stepKeys.some(
      (key) =>
        input.recordedThisTurn.includes(key) &&
        isNoneAnswer(input.answers.get(key)),
    );
    if (saidNone) for (const key of family.stepKeys) settle.add(key);
  }
  return [...settle].filter(
    (key) => INVESTOR_NONE_STEPS.has(key) && input.open.has(key),
  );
}
