import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResult,
  GateQInterviewerVariables,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V4 } from "./gateq-interviewer.v4.js";

const UNKNOWN_ANCHOR =
  "record the dimension with value kind NONE and provenance UNKNOWN.";
const READ_BACK_ANCHOR =
  "Once they have agreed, never ask the same confirmation again.";
const CONTRADICTIONS_RULE =
  "Anything listed under CONTRADICTIONS that they have not yet settled is the next thing to ask about,";

/**
 * Live run 2026-11-14 (Routeix, application f21f0ddc): "Nobody pays yet"
 * and "Revenue so far is zero" were read as NONE, so the review told the
 * founder they did not know their revenue. A stated nothing is a value:
 * the reading now has a ZERO kind for it, and NONE stays for not knowing.
 * The same run paired one weekly-active disagreement with every later
 * traction line, and asked it three times after saying it would leave it
 * open: the reading marks the one statement that disagrees, and a
 * contradiction already put to the founder is shown as such.
 */
const replaced = (text: string, anchor: string, by: string): string => {
  if (!text.includes(anchor)) {
    throw new Error(`GATEQ_INTERVIEWER_V5: anchor moved: ${anchor}`);
  }
  return text.replace(anchor, by);
};

const template = replaced(
  replaced(
    replaced(
      GATEQ_INTERVIEWER_V4.template,
      UNKNOWN_ANCHOR,
      `${UNKNOWN_ANCHOR}
- A stated nothing is not unknown. "Nobody pays yet", "revenue so far is zero", "no customers yet": record that dimension with value kind ZERO and provenance APPLICANT_PROVIDED. NONE is only for not knowing or not saying ("we don't know our revenue yet").`,
    ),
    READ_BACK_ANCHOR,
    `${READ_BACK_ANCHOR}
- disagreesWith: set it on the one fact whose statement gives a different figure for the same quantity than earlier words on record (600 weekly active, then about 1,500 weekly active), quoting those earlier words. Every other fact has disagreesWith null, including other statements about the same dimension (operator growth, willingness to pay) and a summary of what is still open.`,
  ),
  CONTRADICTIONS_RULE,
  `A CONTRADICTIONS line ending "(already asked; leave it open)" was put to them once: never ask it again, and do not say it is open again; it stays open unless they settle it themselves. ${CONTRADICTIONS_RULE}`,
);

export const GATEQ_INTERVIEWER_V5: PromptDefinition<
  GateQInterviewerVariables & { readonly recordableDimensions: string },
  GateQInterviewerResult
> = {
  ...GATEQ_INTERVIEWER_V4,
  version: 5,
  effectiveFrom: "2026-11-14",
  changeDescription:
    'Live run 2026-11-14: a stated zero ("nobody pays yet") is read as a ZERO value, never as unknown; only the statement that disagrees is marked (disagreesWith); a contradiction already put to the founder is not asked again.',
  template,
};
