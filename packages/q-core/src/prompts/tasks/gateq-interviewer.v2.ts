import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResult,
  GateQInterviewerVariables,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V1 } from "./gateq-interviewer.v1.js";

/** Keep the approved dialogue and authority rules; make value shapes explicit. */
export const GATEQ_INTERVIEWER_V2: PromptDefinition<
  GateQInterviewerVariables,
  GateQInterviewerResult
> = {
  ...GATEQ_INTERVIEWER_V1,
  version: 2,
  effectiveFrom: "2026-10-14",
  changeDescription:
    "Preserve typed qualification values during adaptive interviews; a stage repeated as plain text must not erase its canonical code.",
  template: GATEQ_INTERVIEWER_V1.template.replace(
    "WHAT TO RECORD\n",
    'WHAT TO RECORD\n- Qualification value shapes are exact: company.stage uses {"kind":"CODE","code":"seed"} (the declared lowercase stage code); company.country uses CODE with the stated uppercase two-letter country code; company.sector_phrases uses PHRASES; raise.amount uses AMOUNT with a decimal string and uppercase currency; raise.currency uses CODE with the uppercase three-letter currency. Never use TEXT for these dimensions. Unknown or declined uses NONE, never an invented code. A repeated value keeps its canonical shape; a correction uses the new stated value in that same shape.\n',
  ),
};
