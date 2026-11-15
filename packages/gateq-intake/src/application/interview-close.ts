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
 *
 * When to say it is not read from the words of earlier replies (live
 * 5757518c7: a check over the last eight turns said it again at t45). The
 * interviewer decides each reply's ending from the plan and stores with
 * the Q turn whether the close stands (`readyToClose`).
 */

/** The interview step's button that leads to review and Submit. */
export const REVIEW_CONTROL = "Finish and review";

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
