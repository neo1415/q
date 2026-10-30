import type { PromptDefinition } from "../definition.js";
import {
  PLAN_REVIEW_NOTE_MAX,
  PLAN_REVIEW_SCHEMA_NAME,
  PLAN_REVIEW_V4_SCHEMA_VERSION,
  PlanReviewResultV4Schema,
  type PlanReviewResultV4,
  type PlanReviewVariablesV6,
  type PlanWriteResultV2,
  type PlanWriteVariables,
} from "../schemas/plan.js";
import { PLAN_WRITE_V4 } from "./plan.v4.js";
import { PLAN_REVIEW_V6, REVIEW_FIX_V6 } from "./plan.v6.js";

/**
 * Plan job 3a4aa98d (plan c13eabef, "Plan my raise over 8 weeks",
 * 2026-10-30). Round 1 scored 91/87, the redraft 88/76 with R2 flagging
 * an invented fact on step 9; offered as a draft with 17 open points.
 *
 *   - The card showed the reviewers' fixes verbatim: "Remove … from step
 *     10's evidenceNeeded list", "Replace the propose_email action with a
 *     task for you …". A fix is the writer's instruction over the plan's
 *     JSON. PLAN_REVIEW v7 has every rubric defect carry `note` (output
 *     schema v4): one plain line for the person, read under the step's
 *     title, saying what is still unsettled for them. The fix still goes
 *     to the writer whole.
 *   - Step 9 ("Review the draft eight-week raise plan …": "The second
 *     recorded review should test the draft raise plan") cited F31-F33,
 *     three remembered notes of earlier asks for this same plan ("Q said it
 *     would first gather the current position, then draft a plan for two
 *     reviews before presenting it"). Those "two reviews" are Q's own
 *     review of its draft, not anything in the person's raise. The
 *     writer's coverage rule asks that every section bearing on the ask be
 *     used by a step, and Q's memory of this very ask bears on it in words,
 *     so the writer turned Q's own process into a step. R2 was right that
 *     no review was recorded. v5 (writer) and v7 (reviewer): a remembered
 *     note of this ask, or of how Q said it would work on it, is
 *     background -- never a step, never required by coverage. And a
 *     redraft resolves a fix only with what the situation holds.
 *
 * Rubric plan-rubric/v1 and the 99 bar unchanged.
 */

function replaced(template: string, from: string, to: string): string {
  if (template.split(from).length !== 2) {
    throw new Error(
      `plan v7: the line it replaces changed: ${from.slice(0, 60)}`,
    );
  }
  return template.replace(from, to);
}

const OWN_ASK_NOTE =
  "A remembered note of this same ask, or of how Q said it would work on it (gathering the situation, drafting a plan, having it reviewed), is background, not their situation: never a step, never a reason in a why, and coverage never needs it.";

const WRITE_COVERAGE_V2 =
  "1. Coverage: every section of THE SITUATION that holds facts bearing on the ask is used by a step, or openQuestions says in one line why it does not matter. A counterpart who is waiting, an open request, an investor's own note, a held-back document and a contradiction between two figures are never left out.";
export const WRITE_COVERAGE_V5 = `${WRITE_COVERAGE_V2} ${OWN_ASK_NOTE}`;

const WRITE_MODE_V2 =
  "REDRAFT: rewrite PRIOR PLAN so that EVERY numbered point in FIXES is resolved -- each one is a reviewer's deduction or a check code made, and the redraft is scored again on the same checklist; keep what no point touches.";
export const WRITE_MODE_V5 =
  "REDRAFT: rewrite PRIOR PLAN so that EVERY numbered point in FIXES is resolved -- each one is a reviewer's deduction or a check code made, and the redraft is scored again on the same checklist; keep what no point touches. A fix is resolved only with what THE SITUATION holds: where a fix would need a fact, review, meeting or reply the situation does not hold, keep the plan true and leave that out -- an invented fact costs far more than a missed point.";

const REVIEW_COVERAGE_V2 =
  "- situationCoverage (0-15): every section of THE SITUATION that holds facts relevant to the ask is used, or the plan says why not. A waiting counterpart, an open request, a stated investor note, a held-back document or a contradiction between two figures left out is a defect.";
export const REVIEW_COVERAGE_V7 = `${REVIEW_COVERAGE_V2} ${OWN_ASK_NOTE} A step built on such a note (a "review of the draft plan", "the recorded review") states what the situation does not hold: a noInventedFacts defect whose fix removes it.`;

export const REVIEW_NOTE_V7 = `${REVIEW_FIX_V6} note is for the person, who never sees the plan's fields and reads it under the step's own title: one plain sentence, at most ${String(PLAN_REVIEW_NOTE_MAX)} characters, in second person, saying what in that step is still unsettled for them -- about their own investors, figures, documents and decisions, never an edit to the plan's text (not "add", "remove" or "replace" something in the plan), never a field name, action kind, role, tool name, step key or ref ("Your runway is not yet checked against the cash and monthly burn you told Q.", "Nothing yet decides the meeting with Aster Africa Ventures that is already waiting for you."). A firewall defect has no note.`;

export const PLAN_WRITE_V5: PromptDefinition<
  PlanWriteVariables,
  PlanWriteResultV2
> = {
  ...PLAN_WRITE_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    'Plan job 3a4aa98d (2026-10-30, 91/87 -> 88/76): the redraft built step 9 on three remembered notes of this same ask ("Q would draft a plan for two reviews") and called Q\'s own review "the second recorded review"; a reviewer rightly flagged it as invented. A remembered note of this ask or of how Q works on it is background, never a step, and coverage never needs it; a redraft resolves a fix only with what the situation holds. Rubric, bar and output schema v2 unchanged.',
  effectiveFrom: "2026-10-30",
  template: replaced(
    replaced(PLAN_WRITE_V4.template, WRITE_COVERAGE_V2, WRITE_COVERAGE_V5),
    WRITE_MODE_V2,
    WRITE_MODE_V5,
  ),
};

export const PLAN_REVIEW_V7: PromptDefinition<
  PlanReviewVariablesV6,
  PlanReviewResultV4
> = {
  ...PLAN_REVIEW_V6,
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "Plan job 3a4aa98d (2026-10-30): the card showed the reviewers' fixes verbatim (\"Remove … from step 10's evidenceNeeded list\", \"Replace the propose_email action …\"): a fix is the writer's instruction over the plan's JSON. Every rubric defect now also carries note (output schema v4), one plain line for the person about what is still unsettled in that step. A remembered note of this same ask or of how Q works on it is never required by coverage, and a step built on one is an invented fact. Rubric plan-rubric/v1 and the 99 bar unchanged.",
  effectiveFrom: "2026-10-30",
  output: {
    kind: "STRUCTURED",
    schemaName: PLAN_REVIEW_SCHEMA_NAME,
    schemaVersion: PLAN_REVIEW_V4_SCHEMA_VERSION,
    schema: PlanReviewResultV4Schema,
  },
  template: replaced(
    replaced(PLAN_REVIEW_V6.template, REVIEW_COVERAGE_V2, REVIEW_COVERAGE_V7),
    REVIEW_FIX_V6,
    REVIEW_NOTE_V7,
  ),
};
