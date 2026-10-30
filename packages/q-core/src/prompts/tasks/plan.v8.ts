import type { PromptDefinition } from "../definition.js";
import {
  PLAN_REVIEW_NOTE_MAX,
  type PlanReviewResultV4,
  type PlanReviewVariablesV6,
} from "../schemas/plan.js";
import { REVIEW_FIX_V6 } from "./plan.v6.js";
import { PLAN_REVIEW_V7, REVIEW_NOTE_V7 } from "./plan.v7.js";

/**
 * Plan job 0823a533 (plan 93bfe2e4, "Plan my raise over 8 weeks",
 * 2026-10-30, 89/84, offered as a draft). Steps 1-3 decide cards already
 * waiting, and their notes only said so again: step 3, "Approve, change
 * or decline the proposed initial meeting with Aster Africa Ventures",
 * read "The meeting with Aster is waiting for your decision before it can
 * be booked." Read under the step's own title, that tells the person
 * nothing is missing. v7's own second example ("Nothing yet decides the
 * meeting with Aster Africa Ventures that is already waiting for you.")
 * was such a line. v8: a note says what the step lacks or gets wrong that
 * its title does not already say; the example that restated a status is
 * replaced. Rubric plan-rubric/v1, the 99 bar and output schema v4
 * unchanged.
 */
export const REVIEW_NOTE_V8 = `${REVIEW_FIX_V6} note is for the person, who never sees the plan's fields and reads it under the step's own title: one plain sentence, at most ${String(PLAN_REVIEW_NOTE_MAX)} characters, in second person, saying what in that step is still missing or wrong for them -- about their own investors, figures, documents and decisions, never an edit to the plan's text (not "add", "remove" or "replace" something in the plan), never a field name, action kind, role, tool name, step key or ref ("Your runway is not yet checked against the cash and monthly burn you told Q.", "Your answer to Aster's question about your regulatory setup is not yet part of the meeting you are asked to approve."). Never only what the step already is or says (that a card is waiting for their decision, or that the step is not yet done): read under that title, it says nothing is missing. A firewall defect has no note.`;

function replaced(template: string, from: string, to: string): string {
  if (template.split(from).length !== 2) {
    throw new Error(
      `plan v8: the line it replaces changed: ${from.slice(0, 60)}`,
    );
  }
  return template.replace(from, to);
}

export const PLAN_REVIEW_V8: PromptDefinition<
  PlanReviewVariablesV6,
  PlanReviewResultV4
> = {
  ...PLAN_REVIEW_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "Plan job 0823a533 (2026-10-30): the notes on steps that decide waiting cards only said again that the card was waiting (\"The meeting with Aster is waiting for your decision before it can be booked.\"), which under the step's own title says nothing is missing; v7's own example was such a line. A note now says what the step lacks or gets wrong that its title does not already say. Rubric plan-rubric/v1, the 99 bar and output schema v4 unchanged.",
  effectiveFrom: "2026-10-30",
  template: replaced(PLAN_REVIEW_V7.template, REVIEW_NOTE_V7, REVIEW_NOTE_V8),
};
