import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResultV3,
  GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V11 } from "./gateq-interviewer.v11.js";

/**
 * GATEQ_INTERVIEWER v12: an unknown is about what they named (live
 * re-certification 5757518c7, Stockum,
 * audits/2026-11-14-gateq-sustained-journey.md).
 *
 * In the seventh live run "We don't know our CAC yet.", said in answer to
 * "How big is the market?", was stored as company.market UNKNOWN: CAC had
 * no key, and an unknown with no metric went to the dimension Q asked
 * about. v12 lists `cac` and says that an unknown about a named metric
 * carries that metric's key and goes on its dimension, whatever Q asked.
 * "I'm not sure which is right" about two answers already given is not an
 * UNKNOWN statement: the disagreement holds it (it wrote a third Stage
 * row, "Not known").
 *
 * Same variables and output schema as v11.
 */
const anchor =
  '- UNKNOWN is not knowing ("I don\'t know", "not sure which is right"), with declined true for "I\'d rather not say". It never replaces anything on record: use NEW. It goes on the dimension it is about ("we haven\'t sized the market yet" is company.market UNKNOWN), never on application.note.';
if (!GATEQ_INTERVIEWER_V11.template.includes(anchor))
  throw new Error(`GATEQ_INTERVIEWER_V12: anchor moved: ${anchor}`);
const template = GATEQ_INTERVIEWER_V11.template.replace(
  anchor,
  '- UNKNOWN is not knowing ("I don\'t know"), with declined true for "I\'d rather not say". It never replaces anything on record: use NEW. It goes on the dimension it is about ("we haven\'t sized the market yet" is company.market UNKNOWN), never on application.note. An unknown about a metric they name carries that metric\'s key and goes on that metric\'s dimension, whatever you asked: "we don\'t know our CAC yet" is company.business_model UNKNOWN with quantity cac, even in answer to a market question. "Not sure which is right" about two answers already given is no statement at all: the disagreement already says it.',
);

export const GATEQ_INTERVIEWER_V12: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV3
> = {
  ...GATEQ_INTERVIEWER_V11,
  version: 12,
  effectiveFrom: "2026-11-15",
  changeDescription:
    'An unknown about a named metric carries its key and goes on its dimension whatever Q asked (live 5757518c7: "we don\'t know our CAC yet" to a market question became Market not known); cac is listed; "not sure which is right" about a disagreement is no statement.',
  template,
};
