import type { ApplicationStatementView } from "../contracts/statements.js";
import { DIMENSION_LABELS } from "./coverage.js";

/**
 * How the interview ends when nothing is left to ask (live 318577a8e,
 * Solaix): Q answered five turns with "What would you like to cover
 * next?" and its close ("nothing else I need from you right now") never
 * named the review, so the founder had to find "Finish and review" alone.
 *
 * Deterministic words, once: that Q has what it needs, what stays open
 * (answers that disagree, what they said they do not know), and the
 * review step by its on-screen name. Never a claim that something was
 * recorded or left open: it describes the record as it stands.
 */

/** The interview step's button that leads to review and Submit. */
export const REVIEW_CONTROL = "Finish and review";

/**
 * A question about nothing in particular: the founder is asked to pick
 * the topic. With a plan it is replaced by the plan's next question; with
 * nothing left it is never sent (it loops).
 */
const OPEN_ENDED =
  /\b(?:what (?:else )?would you like to (?:cover|discuss|talk about|add|share|go over|tell me)|(?:is there )?anything else (?:you(?:['’]d| would) like|you want|i should know|to add)|what else (?:would|should|can|do) you|where would you like to go next|what(?:['’]s| is) next)\b/iu;

export function isOpenEndedQuestion(sentence: string): boolean {
  return sentence.trim().endsWith("?") && OPEN_ENDED.test(sentence);
}

const listOf = (labels: readonly string[]): string => {
  const words = labels.map((label, index) =>
    index === 0 ? label : label.toLowerCase(),
  );
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
};

/** The line Q says the first time nothing is left to ask. */
export function closingLine(
  view: ApplicationStatementView | undefined,
): string {
  const labelsWith = (statuses: readonly string[]) =>
    (view?.dimensions ?? [])
      .filter((entry) => statuses.includes(entry.status))
      .map((entry) => DIMENSION_LABELS[entry.dimension]);
  const disagree = labelsWith(["DISAGREEMENT_OPEN", "DISAGREEMENT_LEFT_OPEN"]);
  const unknown = labelsWith(["UNKNOWN"]);
  const parts = ["That's everything I need for now."];
  if (disagree.length > 0)
    parts.push(
      `${listOf(disagree)} ${disagree.length === 1 ? "still has" : "each still have"} two answers that disagree, and the investor will see both.`,
    );
  if (unknown.length > 0)
    parts.push(
      `${listOf(unknown)} ${unknown.length === 1 ? "is" : "are"} not known yet.`,
    );
  parts.push(
    `When you're ready, press ${REVIEW_CONTROL} to check your application and submit it.`,
  );
  return parts.join(" ");
}

/** The line after the close, so a turn never ends without a next step. */
export const REVIEW_POINTER = `${REVIEW_CONTROL} is ready whenever you are.`;

/** Whether Q already pointed the founder to the review in this interview. */
export function pointedToReview(qLines: readonly string[]): boolean {
  return qLines.some((line) => line.includes(REVIEW_CONTROL));
}
