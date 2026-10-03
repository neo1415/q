import type { PromptDefinition } from "../definition.js";
import type {
  RehearsalReviewLenient,
  RehearsalReviewVariables,
} from "../schemas/rehearsal.js";
import { REHEARSAL_SCORE_V4 } from "./rehearsal-score.v4.js";

/**
 * REHEARSAL_SCORE v5 -- v4, written to the person as "you" (QA rehearsal
 * 064ff78f: the review on their own page called them "the founder"). Same
 * lenient output as v4.
 */
export const REHEARSAL_SCORE_V5_RULE =
  '- Write to them directly, as "you" and "your": this is their own review. Never call them "the founder", "the investor", "the person rehearsing" or by their role.';

const ANCHOR = "- No percentages or scores out of anything. Words only.";

if (REHEARSAL_SCORE_V4.template.split(ANCHOR).length !== 2) {
  throw new Error(
    "REHEARSAL_SCORE v5 adds one rule after v4's first, which changed",
  );
}

export const REHEARSAL_SCORE_V5: PromptDefinition<
  RehearsalReviewVariables,
  RehearsalReviewLenient
> = {
  ...REHEARSAL_SCORE_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    'QA rehearsal 064ff78f: the review addresses the person rehearsing as "you", never by their role.',
  effectiveFrom: "2026-10-03",
  template: REHEARSAL_SCORE_V4.template.replace(
    ANCHOR,
    `${REHEARSAL_SCORE_V5_RULE}\n${ANCHOR}`,
  ),
};
