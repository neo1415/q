import type { PromptDefinition } from "../definition.js";
import {
  PLAN_REVIEW_SCHEMA_NAME,
  PLAN_REVIEW_V2_SCHEMA_VERSION,
  PlanReviewResultV2Schema,
  type PlanReviewResultV2,
  type PlanReviewVariables,
  type PlanWriteResultV2,
  type PlanWriteVariables,
} from "../schemas/plan.js";
import { PLAN_REVIEW_V3, PLAN_WRITE_V3 } from "./plan.v3.js";

/**
 * Plan job 37655270 (plan d79a3147, "Plan my raise over 8 weeks",
 * 2026-10-30). Round 1 scored 81/73, round 2 92/92; offered as a draft.
 * What the reviewers rightly wanted traced to the writer's own rules:
 *
 *   - Two messages to Aster were waiting for the founder's approval (F28,
 *     F29). v3 told the writer to put first "one Q can start now (owner Q
 *     or TOGETHER)", so step 1 was Q redrafting the update while the
 *     waiting messages were left undecided, and F29 was never cited.
 *     v4: what already waits for their approval is decided first.
 *   - v3's owner rule said to word an approved action "as Q preparing it
 *     for their approval"; the writer used those words on a DOCUMENTS draft
 *     (which needs no approval), so the step said "for your approval" with
 *     needsApproval false. v4: only an approved action is worded so; a
 *     draft is a draft, and sending it is a later approved step.
 *   - Step 1 cited their activity counts (F1, F2: evidence items created,
 *     sources registered) under v3's "the ref of every fact the words
 *     state" ("the evidence that is available"). v4: activity is cited
 *     only when the step states that very activity.
 *   - Step 9 shared "the revised deck" that no step filed. v4: a step that
 *     uses what another must produce comes after a step that produces it,
 *     a revised document filed in the data room before it is shared.
 *
 * The reviewer (R1 round 2) marked the firewall failed with 15/15 for no
 * invented facts and no defect named. v4's review must name the step and
 * the words that expose the material (output schema v2); code treats an
 * unnamed integrity verdict as an open point, a named one as fatal.
 *
 * The rubric (plan-rubric/v1) and the 99 bar are unchanged.
 */

function replaced(template: string, from: string, to: string): string {
  if (template.split(from).length !== 2) {
    throw new Error(
      `plan v4: the v3 line it replaces changed: ${from.slice(0, 60)}`,
    );
  }
  return template.replace(from, to);
}

const WRITE_ORDER_V3 =
  "- steps: 4 to 8 usually, at most 12, most important first: a counterpart who is waiting or asked for something, then the gap that blocks the most, then new opportunities. When anything can start now, the first step is one Q can start now (owner Q or TOGETHER).";
export const WRITE_ORDER_V4 =
  '- steps: 4 to 8 usually, at most 12, most important first. FIRST, whatever is already waiting for their approval (Q\'S WORK AND APPROVALS: "Waiting for your approval" -- a message, a meeting, a profile change): the opening step or steps ask them to approve, change or decline that very card, cite every such waiting item, and say plainly that nothing goes out until they decide. Never draft a new version of something that is waiting while it waits: a replacement comes in a later step, only if they decline or change it. Then a counterpart who is waiting or asked for something, then the gap that blocks the most, then new opportunities. After the waiting decisions, when anything can start now, the next step is one Q can start now (owner Q or TOGETHER).';

const WRITE_FEASIBLE_V2 =
  "5. Feasible: each step can be done as written, in that order; a step that needs something from an earlier step comes after it and is due after it; a date does not assume evidence the situation says is missing or unknown -- obtaining it comes first.";
export const WRITE_FEASIBLE_V4 =
  "5. Feasible: each step can be done as written, in that order; a step that needs something from an earlier step comes after it and is due after it; a date does not assume evidence the situation says is missing or unknown -- obtaining it comes first. Every prerequisite is its own step: a step that uses what does not exist yet (a revised document, a confirmed figure, a shortlist) comes after the step that produces it, and a revised or new document is filed in the data room in its own step before any step shares it.";

const WRITE_APPROVAL_V3 =
  'Word it as Q preparing it for their approval ("Q prepares the change to your profile for your approval"), never as Q acting alone.';
export const WRITE_APPROVAL_V4 =
  'Word it as Q preparing it for their approval ("Q prepares the change to your profile for your approval"), never as Q acting alone. Only such an action is worded "for your approval": a WORKFORCE role not approved by them (RESEARCH, DOCUMENTS) only drafts -- say "Q drafts ..." -- and sending or using the draft is a later step with an action they approve.';

const WRITE_GROUNDED_TAIL_V3 =
  "At most 8 cites: a step that would need more names too much at once; split it, or keep it to what matters most.";
export const WRITE_GROUNDED_TAIL_V4 =
  "At most 8 cites: a step that would need more names too much at once; split it, or keep it to what matters most. WHAT YOU DID RECENTLY (counts of their own recent acts) is background: cite an activity only when the step's words state that very activity.";

const REVIEW_FIREWALL_V2 =
  "- firewall: held is false when the plan carries the other side's private data that the situation does not show was shared with this person.";
export const REVIEW_FIREWALL_V4 =
  "- firewall: held is false when the plan carries the other side's private data that the situation does not show was shared with this person, or states what a held-back document contains. held false needs at least one firewall defect naming it: stepKey (null when it is in the summary or open questions), exposed (the plan's own words that carry it, copied exactly), problem and fix. A verdict with nothing named cannot be checked and is not counted as a breach. Naming a private or held-back document as held back, or by its title in its own share-approval step, is no breach.";

const REVIEW_PROBLEM_V2 = "problem in one sentence;";
const REVIEW_PROBLEM_V4 =
  'problem in one sentence; in problem and fix call the person "the person", never by their name;';

export const PLAN_WRITE_V4: PromptDefinition<
  PlanWriteVariables,
  PlanWriteResultV2
> = {
  ...PLAN_WRITE_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    'Plan job 37655270 (2026-10-30, 92/92 after one redraft): what already waits for the person\'s approval is decided first (v3 put a Q-startable step first, so a redraft of a waiting Aster message led while the message waited); only an action the person approves is worded "for your approval" (a DOCUMENTS draft said it with needsApproval false); activity counts are cited only when the step states that activity; every prerequisite is its own step, a revised document filed in the data room before it is shared. Rubric, bar and output schema v2 unchanged.',
  effectiveFrom: "2026-10-30",
  template: replaced(
    replaced(
      replaced(
        replaced(PLAN_WRITE_V3.template, WRITE_ORDER_V3, WRITE_ORDER_V4),
        WRITE_FEASIBLE_V2,
        WRITE_FEASIBLE_V4,
      ),
      WRITE_APPROVAL_V3,
      WRITE_APPROVAL_V4,
    ),
    WRITE_GROUNDED_TAIL_V3,
    WRITE_GROUNDED_TAIL_V4,
  ),
};

export const PLAN_REVIEW_V4: PromptDefinition<
  PlanReviewVariables,
  PlanReviewResultV2
> = {
  ...PLAN_REVIEW_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    'Plan job 37655270 (2026-10-30): a reviewer marked the firewall failed with no defect named and no step quoting private material. A firewall verdict now names the step and the plan\'s own words that expose the material (output schema v2: firewall defects carry `exposed`); code holds a named breach fatal and an unnamed one as an open point. Problems and fixes call the person "the person", never by name. Rubric plan-rubric/v1 and the 99 bar unchanged.',
  effectiveFrom: "2026-10-30",
  output: {
    kind: "STRUCTURED",
    schemaName: PLAN_REVIEW_SCHEMA_NAME,
    schemaVersion: PLAN_REVIEW_V2_SCHEMA_VERSION,
    schema: PlanReviewResultV2Schema,
  },
  template: replaced(
    replaced(PLAN_REVIEW_V3.template, REVIEW_FIREWALL_V2, REVIEW_FIREWALL_V4),
    REVIEW_PROBLEM_V2,
    REVIEW_PROBLEM_V4,
  ),
};
