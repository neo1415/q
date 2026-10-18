import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V17_SCHEMA_VERSION,
  CompanyAnalystV17ResultSchema,
  type CompanyAnalystV17Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V16 } from "./company-analyst.v16.js";

/**
 * COMPANY_ANALYST v17 -- answers as cards (founder brief 2026-10-05,
 * C1-C5 and C9; ADR 0053).
 *
 * Live on 5 October: "the companies in my feed ranked against my mandate"
 * came back as a paragraph; "three startups side by side" came back as a
 * Markdown table, comparison cards and, unasked, a PDF; "three articles
 * from Y Combinator" came back as bullets. v17 asks for answerCards
 * whenever the answer is things to see together, keeps the answer text a
 * short spoken summary, and lets a ranked answer exist: the model gives a
 * level per measure, and Capital Q computes the fit out of 10 and the
 * order from those levels, so no number is the model's.
 */
export const V16_CARDS_LINE =
  'Comparing 2-4 named things: also fill comparisonCards (no order or verdict, 1-4 points each, unknown is "Not known"); else null.';
export const V17_CARDS_LINE =
  "Things to see together (a top N, a comparison, research parts): fill answerCards (comparisonCards null); the answer is a few spoken sentences about them, never a table of them. No file unless asked.";

const V16_NO_SCORE =
  "Produce no score, rating, ranking, quality percentage, investment probability, funding likelihood, readiness level, fit score or peer benchmark,";
const V17_NO_SCORE =
  "Except answerCards' measure levels, produce no score, rating, ranking, quality percentage, investment probability, funding likelihood, readiness level, fit score or peer benchmark,";

for (const anchor of [V16_CARDS_LINE, V16_NO_SCORE]) {
  if (COMPANY_ANALYST_V16.template.split(anchor).length !== 2) {
    throw new Error(
      `COMPANY_ANALYST v17 rewrites v16, which changed: ${anchor}`,
    );
  }
}

export const COMPANY_ANALYST_V17: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV17Result
> = {
  ...COMPANY_ANALYST_V16,
  version: 17,
  // Deprecated by v18 (fit out of 10 and sharper advice, 2026-10-06).
  status: "DEPRECATED",
  changeDescription:
    "Founder brief 2026-10-05 (C1-C5, C9): answerCards for a top N, a comparison or research parts, with a level per measure from which code computes fit and order; the answer text a short spoken walk-through; no table of the same things and no file unless asked.",
  effectiveFrom: "2026-10-05",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V17_SCHEMA_VERSION,
    schema: CompanyAnalystV17ResultSchema,
  },
  template: COMPANY_ANALYST_V16.template
    .replace(V16_CARDS_LINE, V17_CARDS_LINE)
    .replace(V16_NO_SCORE, V17_NO_SCORE),
};
