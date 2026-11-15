import type { PromptDefinition } from "../definition.js";
import {
  GATEQ_INTERVIEWER_SCHEMA_NAME,
  GATEQ_INTERVIEWER_SCHEMA_VERSION_V3,
  GateQInterviewerResultV3Schema,
  type GateQInterviewerResultV3,
  type GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V9 } from "./gateq-interviewer.v9.js";

/**
 * GATEQ_INTERVIEWER v10: a count names a metric only when it counts that
 * metric's unit, and words are their own (live re-certification 30c99ccc5,
 * audits/2026-11-14-gateq-sustained-journey.md).
 *
 * In the fifth live run "2,300 patient records digitised" was read as
 * `customers`, and code paired it with "from 1 clinic to 4" as a false
 * disagreement; "by revenue we're seed" was stored as "by revenue I'd say
 * seed"; and "they get paid faster because fewer claims are rejected" was
 * stored as the company description. v10:
 *
 *   - every COUNT says what it counts (`unit`, reading schema v3): the
 *     metric's listed unit when it is that metric, otherwise their own noun
 *     with quantity null. Code drops the metric of a count whose unit does
 *     not fit it, so a misread can no longer link;
 *   - words are a span copied from what they said, never a paraphrase;
 *   - company.description is what the company is and does; an outcome or
 *     benefit for its customers is company.solution;
 *   - `asking` names the dimension the question is really about, and a
 *     question on a dimension already answered (KNOWN FACTS, the form
 *     included) is not asked.
 *
 * Same variables as v9; STATEMENT QUANTITIES now lists each unit.
 */
const replaced = (text: string, anchor: string, by: string): string => {
  if (!text.includes(anchor))
    throw new Error(`GATEQ_INTERVIEWER_V10: anchor moved: ${anchor}`);
  return text.replace(anchor, by);
};

let template = GATEQ_INTERVIEWER_V9.template;
template = replaced(
  template,
  "- words: their exact words for that one statement, as said.",
  '- words: their exact words for that one statement, copied as a span of what they said, never reworded or summarised ("by revenue we\'re seed", never "by revenue I\'d say seed").',
);
template = replaced(
  template,
  "asOf: the date the figure describes as YYYY-MM-DD",
  'unit: for a COUNT, what one of it is. When the count is one of STATEMENT QUANTITIES, that quantity\'s unit exactly as listed (4 clinics that use the product are 4 customers: quantity customers, unit "customer"). When it counts something else, their own noun in the singular and quantity null: "2,300 patient records digitised" is unit "patient record", quantity null, never customers or users. null for anything that is not a COUNT. asOf: the date the figure describes as YYYY-MM-DD',
);
template = replaced(
  template,
  "- asking: the dimension your question is about, or null.",
  '- asking: the dimension your question is really about (a question about the country is company.country), or null. Never ask about a dimension KNOWN FACTS already holds an answer for, from the form or from them, a range or an approximate answer included, unless QUESTION NEEDS lists it. company.description is what the company is and does; an outcome or benefit for its customers ("they get paid faster") is company.solution, never company.description.',
);

export const GATEQ_INTERVIEWER_V10: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV3
> = {
  ...GATEQ_INTERVIEWER_V9,
  version: 10,
  effectiveFrom: "2026-11-15",
  changeDescription:
    "A count names a metric only when it counts that metric's unit (live 30c99ccc5: patient records read as customers): reading schema v3 adds unit to each statement; words are a verbatim span; an outcome is company.solution, never the description; asking names the real topic and never an answered dimension.",
  output: {
    kind: "STRUCTURED",
    schemaName: GATEQ_INTERVIEWER_SCHEMA_NAME,
    schemaVersion: GATEQ_INTERVIEWER_SCHEMA_VERSION_V3,
    schema: GateQInterviewerResultV3Schema,
  },
  template,
};
