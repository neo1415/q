import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResult,
  GateQInterviewerVariables,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V4 } from "./gateq-interviewer.v4.js";

const UNKNOWN_ANCHOR =
  "record the dimension with value kind NONE and provenance UNKNOWN.";

/**
 * Live run 2026-11-14 (Routeix, application f21f0ddc): "Nobody pays yet"
 * and "Revenue so far is zero" were read as NONE, so the review told the
 * founder they did not know their revenue. A stated nothing is a value:
 * the reading now has a ZERO kind for it, and NONE stays for not knowing.
 */
const template = GATEQ_INTERVIEWER_V4.template.replace(
  UNKNOWN_ANCHOR,
  `${UNKNOWN_ANCHOR}
- A stated nothing is not unknown. "Nobody pays yet", "revenue so far is zero", "no customers yet": record that dimension with value kind ZERO and provenance APPLICANT_PROVIDED. NONE is only for not knowing or not saying ("we don't know our revenue yet").`,
);

if (template === GATEQ_INTERVIEWER_V4.template) {
  throw new Error("GATEQ_INTERVIEWER_V5: the unknown-answer anchor moved");
}

export const GATEQ_INTERVIEWER_V5: PromptDefinition<
  GateQInterviewerVariables & { readonly recordableDimensions: string },
  GateQInterviewerResult
> = {
  ...GATEQ_INTERVIEWER_V4,
  version: 5,
  effectiveFrom: "2026-11-14",
  changeDescription:
    "Live run 2026-11-14: a stated zero (\"nobody pays yet\") is read as a ZERO value, never as unknown; NONE stays for not knowing.",
  template,
};
