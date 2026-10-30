import type { PromptDefinition } from "../definition.js";
import type {
  PlanReviewResult,
  PlanReviewVariables,
  PlanWriteResultV2,
  PlanWriteVariables,
} from "../schemas/plan.js";
import { PLAN_REVIEW_V2, PLAN_WRITE_V2 } from "./plan.v2.js";

/**
 * Q-page sweep 2026-10-29 (F07, F14). Both founder plans came back as
 * drafts (reviews 85-94 against the 99 bar, after one redraft), and most of
 * what the reviewers still wanted was the same two things:
 *
 *   - cites: the writer was told to cite "only those this step rests on",
 *     the reviewers marked down every fact a step's words stated without
 *     its ref ("cite F29 for the pending profile update", "F38 concerns
 *     Aster's interest, not the update"). Writer and reviewer now hold one
 *     rule: the ref of every fact the words state, that very fact, at most
 *     eight; the move itself and what the step sets out to obtain need no
 *     cite of their own.
 *   - owner: an action the person approves on its own card (a profile
 *     change, a document share) is Q's to prepare, as code classifies it,
 *     while both prompts' rubric read approval as TOGETHER; the reviewers
 *     deducted on every such step. The reviewers now see needsApproval,
 *     the roster marks what needs approval, and both prompts accept Q or
 *     TOGETHER for it, worded as Q preparing it for their approval.
 *
 * The rubric and the 99 bar are unchanged.
 */

function replaced(template: string, from: string, to: string): string {
  if (template.split(from).length !== 2) {
    throw new Error(
      `plan v3: the v2 line it replaces changed: ${from.slice(0, 60)}`,
    );
  }
  return template.replace(from, to);
}

const WRITE_GROUNDED_V2 =
  "3. Grounded: every step's cites are refs THE SITUATION or PUBLIC FINDINGS hold, and those facts support its why.";
const WRITE_GROUNDED_V3 =
  "3. Grounded: every step's cites hold the ref of each fact its words state -- each gap, figure, note, pending change, held-back document or contradiction its title, why or evidenceNeeded names has the ref of that very fact in cites (never a neighbouring fact's) -- and no ref it does not use. The move itself (book the call, approve the card) and what the step sets out to obtain (something unknown) need no ref beyond the fact that makes the step necessary. At most 8 cites: a step that would need more names too much at once; split it, or keep it to what matters most.";

const WRITE_OWNER_V2 =
  "TOGETHER when Q prepares through a listed action or WORKFORCE role and they finish or approve the substance. A TASK is never Q's.";
const WRITE_OWNER_V3 =
  'TOGETHER when Q prepares through a listed action or WORKFORCE role and they finish or approve the substance. An action ALLOWED ACTIONS says is for their approval or approved by them (each TOOL_PROPOSAL, an APP_ACTION marked "needs your approval", the WORKFORCE roles approved by them) is Q\'s to prepare and theirs to approve on its own card, before anything happens: owner Q, or TOGETHER when they also supply or decide something in it. Word it as Q preparing it for their approval ("Q prepares the change to your profile for your approval"), never as Q acting alone. A TASK is never Q\'s.';

const WRITE_SHAPE_CITES_V2 =
  "- cites: 1 to 8 refs, exactly as given, only those this step rests on.";
const WRITE_SHAPE_CITES_V3 =
  "- cites: 1 to 8 refs, exactly as given: the ref of every fact the step's words state, and no other.";

const REVIEW_CITES_V2 =
  "(Code has already dropped any ref the situation does not hold.)";
const REVIEW_CITES_V3 =
  "A missing cite is a fact the step's words state whose ref is not in its cites: name the ref to add. The move itself (book the call, approve the card) and what the step sets out to obtain need no cite beyond the fact that makes the step necessary, and a step holds at most 8 cites: never ask for more than 8. (Code has already dropped any ref the situation does not hold.)";

const REVIEW_OWNER_V2 =
  "(Code has already set each step's owner and approval from its action; deduct only where the step's words contradict that.)";
const REVIEW_OWNER_V3 =
  "(Code has already set each step's owner and approval from its action. needsApproval true means Q prepares it and the person approves it on its own card before anything happens: owner Q and owner TOGETHER are both right for such a step, so never deduct for either, nor ask for YOU. Deduct only where the step's words contradict its owner, such as Q said to act alone on something the person approves.)";

const REVIEW_DEFECTS_V2 = "Most important first, at most eight per item;";
const REVIEW_DEFECTS_V3 =
  "Each defect is listed once, under the item it belongs to. Most important first, at most eight per item;";

export const PLAN_WRITE_V3: PromptDefinition<
  PlanWriteVariables,
  PlanWriteResultV2
> = {
  ...PLAN_WRITE_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Q-page sweep 2026-10-29 (F07, F14): both founder plans stayed drafts, the reviewers asking mostly for cites and owners. v3 holds the writer to the reviewers' cite rule (the ref of every fact the words state, that very fact, at most 8; the move itself and what is to be obtained need none of their own) and says an action the person approves on its own card is Q's to prepare (or TOGETHER when they also supply something), worded as Q preparing it for their approval. Rubric, bar and output schema v2 unchanged.",
  effectiveFrom: "2026-10-30",
  template: replaced(
    replaced(
      replaced(PLAN_WRITE_V2.template, WRITE_GROUNDED_V2, WRITE_GROUNDED_V3),
      WRITE_OWNER_V2,
      WRITE_OWNER_V3,
    ),
    WRITE_SHAPE_CITES_V2,
    WRITE_SHAPE_CITES_V3,
  ),
};

export const PLAN_REVIEW_V3: PromptDefinition<
  PlanReviewVariables,
  PlanReviewResult
> = {
  ...PLAN_REVIEW_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Q-page sweep 2026-10-29 (F07, F14): the same cite rule as the writer's (a missing cite is a stated fact without its ref; the move and what is to be obtained need none; never more than 8), an approved action (needsApproval, now shown in the plan) may be owned by Q or TOGETHER and is never deducted for that, and each defect listed once. Rubric plan-rubric/v1 and the 99 bar unchanged.",
  effectiveFrom: "2026-10-30",
  template: replaced(
    replaced(
      replaced(PLAN_REVIEW_V2.template, REVIEW_CITES_V2, REVIEW_CITES_V3),
      REVIEW_OWNER_V2,
      REVIEW_OWNER_V3,
    ),
    REVIEW_DEFECTS_V2,
    REVIEW_DEFECTS_V3,
  ),
};
