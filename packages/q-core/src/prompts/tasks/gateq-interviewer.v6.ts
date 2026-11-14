import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResult,
  GateQInterviewerVariables,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V5 } from "./gateq-interviewer.v5.js";

const DISAGREES_ANCHOR =
  "- disagreesWith: set it on the one fact whose statement";
const ZERO_ANCHOR =
  'NONE is only for not knowing or not saying ("we don\'t know our revenue yet").';

/**
 * Live run 2026-11-14 (Layerum, application cdcf286b): "about 1,500 weekly
 * active now" was read as a correction while Q asked "which figure should
 * I use?", and the whole of traction was replaced by that one line. A
 * correction now names the earlier words it replaces (`corrects`), and a
 * figure Q is going to ask about is a disagreement, not a correction. The
 * same run stored "the main risk is the licence renewal timing" as the
 * company's problem, and asked for twelve months of billing after "nobody
 * pays yet".
 */
const replaced = (text: string, anchor: string, by: string): string => {
  if (!text.includes(anchor)) {
    throw new Error(`GATEQ_INTERVIEWER_V6: anchor moved: ${anchor}`);
  }
  return text.replace(anchor, by);
};

const template = replaced(
  replaced(
    GATEQ_INTERVIEWER_V5.template,
    DISAGREES_ANCHOR,
    `- corrects: when correction is true, quote the earlier words it replaces exactly (only that statement gives way; every other statement on the dimension stays). Null otherwise.
- Correction or disagreement: if you are going to ask which of two figures is right, they have not said the new one replaces the old: set correction false and disagreesWith. correction true only when they say the earlier words were wrong or are replaced.
${DISAGREES_ANCHOR}`,
  ),
  ZERO_ANCHOR,
  `${ZERO_ANCHOR} Once revenue is a stated zero, never ask for revenue amounts, billing or a revenue period again.
- company.problem is the problem the company solves for its customers. A risk, worry or open issue they name ("the main risk is the licence renewal timing") is never the problem: record it in application.note.`,
);

export const GATEQ_INTERVIEWER_V6: PromptDefinition<
  GateQInterviewerVariables & { readonly recordableDimensions: string },
  GateQInterviewerResult
> = {
  ...GATEQ_INTERVIEWER_V5,
  version: 6,
  effectiveFrom: "2026-11-14",
  changeDescription:
    "Live run 2026-11-14 (D11): a correction quotes the earlier words it replaces (corrects); a figure Q will ask about is a disagreement, not a correction; a named risk is never the company's problem; a stated zero revenue is not asked about again.",
  template,
};
