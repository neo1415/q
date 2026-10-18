import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV17Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V17 } from "./company-analyst.v17.js";

/**
 * COMPANY_ANALYST v18 -- advice with numbers (autopilot P2, 2026-10-06).
 *
 * Two changes, both small:
 *
 * 1. Fit as a number out of 10 (ADR 0059). When Q ranks, compares or
 *    assesses companies for an investor it reads the fit Capital Q computed
 *    (fit_profile / fit_top_candidates, whose text carries "7.5/10 · Good
 *    fit") and repeats that score beside its words. The number is code's,
 *    never the model's; no score given means the words alone; never a
 *    percentage. v17 forbade every fit score, so Q answered "which should I
 *    look at first" in adjectives.
 * 2. Sharper advice. A "what should I do / which one" answer leads with an
 *    explicit recommendation, then the two or three reasons that matter, the
 *    biggest risk and the next concrete step, with evidence and inference
 *    told apart -- the charter's analyst, made concrete for the answer.
 */
export const V17_NO_SCORE =
  "Except answerCards' measure levels, produce no score, rating, ranking, quality percentage, investment probability, funding likelihood, readiness level, fit score or peer benchmark,";
export const V18_NO_SCORE =
  "Except answerCards' measure levels and Capital Q's fit out of 10, produce no score, rating, ranking, quality percentage, investment probability, funding likelihood, readiness level, fit score of your own or peer benchmark,";

export const V17_MANDATE_LINE =
  "Asked whether a company suits what they invest in, with their declared mandate among the facts: compare each declared criterion (matches, misses, not on record). No score or verdict.";
export const V18_MANDATE_LINE =
  'Ranking, comparing or assessing companies for an investor: use fit_profile or fit_top_candidates and give each fit as the score out of 10 in its text beside the words ("7.5/10 · Good fit"), as given; none given, the words alone; never % or your own number. Then the criteria that matter (matches, misses, not on record).';

const V17_ANALYTICAL_ANCHOR =
  "Use clarifyingQuestions for at most three questions that would change the answer.";
export const V18_ADVICE_LINE =
  "Asked what to do or which to pick: your recommendation first, then the 2-3 reasons that matter (evidence vs your inference), the biggest risk, the next step.";

for (const anchor of [V17_NO_SCORE, V17_MANDATE_LINE, V17_ANALYTICAL_ANCHOR]) {
  if (COMPANY_ANALYST_V17.template.split(anchor).length !== 2) {
    throw new Error(
      `COMPANY_ANALYST v18 rewrites v17, which changed: ${anchor}`,
    );
  }
}

export const COMPANY_ANALYST_V18: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV17Result
> = {
  ...COMPANY_ANALYST_V17,
  version: 18,
  // Deprecated by v19 (one-pagers and memos, Q room W5, 2026-10-07).
  status: "DEPRECATED",
  changeDescription:
    "Autopilot P2 (2026-10-06): fit as Capital Q's computed score out of 10 beside its words when ranking, comparing or assessing companies (ADR 0059; never the model's number, never %); advice opens with an explicit recommendation, the reasons that matter, the biggest risk and the next step.",
  effectiveFrom: "2026-10-06",
  template: COMPANY_ANALYST_V17.template
    .replace(V17_NO_SCORE, V18_NO_SCORE)
    .replace(V17_MANDATE_LINE, V18_MANDATE_LINE)
    .replace(
      V17_ANALYTICAL_ANCHOR,
      `${V17_ANALYTICAL_ANCHOR} ${V18_ADVICE_LINE}`,
    ),
};
