import type { PromptDefinition } from "../definition.js";
import {
  PLAN_REVIEW_UNTRUSTED,
  PlanReviewVariablesV6Schema,
  type PlanReviewResultV3,
  type PlanReviewVariablesV6,
} from "../schemas/plan.js";
import { PLAN_REVIEW_V5 } from "./plan.v5.js";

/**
 * Plan job ea7508c9 (plan 01f706cf, 2026-10-30, 82/69 -> 92/90, a draft
 * with 12 open points). What the reviewers asked that the prompt caused:
 *
 *   - R2 called due dates 31 October to 13 November "already past" on 30
 *     October and asked to "rebase every due date": the reviewer was never
 *     told today's date, so it took the latest dated record (a reminder, a
 *     board date) for now. v6 gives TODAY and judges every date against it.
 *   - R1's "[s10] Replace it with plain wording ..." reached the person
 *     without its problem, so "it" named nothing. The person reads the fix
 *     alone: v6 has a fix quote the words it changes, never "it" or "this"
 *     for words only the problem names (the v2 example itself said "move
 *     this after S2").
 *   - R2 put two changes in one fix ("rebase every due date ... and extend
 *     the final follow-up through the end of the window"), the second
 *     R1's own point in other words: one change per defect, so code can
 *     merge the same ask by its step and refs.
 *
 * Rubric plan-rubric/v1, the 99 bar and output schema v3 unchanged.
 */

function replaced(template: string, from: string, to: string): string {
  if (template.split(from).length !== 2) {
    throw new Error(
      `plan v6: the v5 line it replaces changed: ${from.slice(0, 60)}`,
    );
  }
  return template.replace(from, to);
}

const REVIEW_FEASIBILITY_V2 =
  "- feasibility (0-10): each step can be done as written by its owner, in a sensible order, with due dates that fit what is waiting and what is still unknown.";
export const REVIEW_FEASIBILITY_V6 =
  "- feasibility (0-10): each step can be done as written by its owner, in a sensible order, with due dates that fit what is waiting and what is still unknown. TODAY is {{today}}: judge every date against TODAY. A due date on or after TODAY is not past. A record dated after TODAY (a reminder, a meeting, a board date) is in the future; it never means TODAY is later.";

const REVIEW_FIX_V2 =
  'fix is the concrete change ("name Kestrel Ventures and cite their note", "move this after S2: it needs S2\'s figures").';
export const REVIEW_FIX_V6 =
  'fix is the concrete change, and it is read on its own, without the problem: quote the plan\'s words it changes, never "it", "this" or "that" for words only the problem names ("name Kestrel Ventures and cite their note", "replace “data-room record” with “your documents in the data room”", "move the call with Kestrel after S2: it needs S2\'s figures"). One change per defect: two changes are two defects, each with its own stepKey and refs.';

export const PLAN_REVIEW_V6: PromptDefinition<
  PlanReviewVariablesV6,
  PlanReviewResultV3
> = {
  ...PLAN_REVIEW_V5,
  version: 6,
  status: "ACTIVE",
  changeDescription:
    'Plan job ea7508c9 (2026-10-30, 92/90 after one redraft): the reviewers were not told today\'s date, and one called 31 Oct-13 Nov "already past" on 30 Oct; v6 gives TODAY (variable today) and judges every date against it. A fix is read alone by the person: it quotes the words it changes, never "it" for words only the problem names ("Replace it with plain wording"). One change per defect, so the same ask merges by step and refs. Rubric plan-rubric/v1, the 99 bar and output schema v3 unchanged.',
  effectiveFrom: "2026-10-30",
  variables: {
    schema: PlanReviewVariablesV6Schema,
    untrusted: [...PLAN_REVIEW_UNTRUSTED],
  },
  template: replaced(
    replaced(
      PLAN_REVIEW_V5.template,
      REVIEW_FEASIBILITY_V2,
      REVIEW_FEASIBILITY_V6,
    ),
    REVIEW_FIX_V2,
    REVIEW_FIX_V6,
  ),
};
