import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResultV3,
  GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V10 } from "./gateq-interviewer.v10.js";

/**
 * GATEQ_INTERVIEWER v11: how the product works is the solution, never the
 * business model (live re-certification 318577a8e, Solaix,
 * audits/2026-11-14-gateq-sustained-journey.md).
 *
 * In the sixth live run "Day to day, an agent installs the kit, the
 * household pays by M-Pesa, and the kit unlocks for each day that is
 * paid" was read as company.business_model, so the review and dossier
 * showed Solution as "Missing". v11 says which is which: how the product
 * works day to day is company.solution; company.business_model is only
 * how the company makes money.
 *
 * Same variables and output schema as v10.
 */
const anchor =
  'an outcome or benefit for its customers ("they get paid faster") is company.solution, never company.description.';
if (!GATEQ_INTERVIEWER_V10.template.includes(anchor))
  throw new Error(`GATEQ_INTERVIEWER_V11: anchor moved: ${anchor}`);
const template = GATEQ_INTERVIEWER_V10.template.replace(
  anchor,
  `${anchor} How the product works day to day (who does what, step by step: "an agent installs the kit, the household pays by M-Pesa, and the kit unlocks") is company.solution, never company.business_model; company.business_model is only how the company makes money (prices, fees, who pays and how often).`,
);

export const GATEQ_INTERVIEWER_V11: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV3
> = {
  ...GATEQ_INTERVIEWER_V10,
  version: 11,
  effectiveFrom: "2026-11-15",
  changeDescription:
    "How the product works day to day is company.solution, never company.business_model (live 318577a8e: the day-to-day answer was filed as business model, so Solution showed Missing); business_model is only how the company makes money.",
  template,
};
