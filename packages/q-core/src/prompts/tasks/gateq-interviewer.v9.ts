import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResultV2,
  GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V8 } from "./gateq-interviewer.v8.js";

/**
 * GATEQ_INTERVIEWER v9: the founder's own acts on what is on record do not
 * depend on how the turn is labelled (live re-certification 78f8d72d5,
 * audits/2026-11-14-gateq-sustained-journey.md).
 *
 * In the fourth live run, three bare "leave it open" turns were labelled
 * QUESTION_FOR_Q (a request to Q read as a question for Q), and an undated
 * "back to users: about 1,500 weekly active users" was read as CORRECTS of
 * 600. Code now applies a leave-open whatever the label and lets a
 * CORRECTS hide a figure only when the founder signalled a correction; v9
 * tells the reader the same, so what it reads already fits:
 *
 *   - a request to leave a disagreement open (even phrased to Q, "please
 *     leave that open", "can you leave it open?") is intent ANSWER with a
 *     LEAVE_OPEN action, never QUESTION_FOR_Q;
 *   - CORRECTS only when they say the earlier answer was wrong or replaced;
 *     a different figure for the same metric said without that is
 *     DISAGREES, and Q asks which is right;
 *   - "not known" about a topic goes on that topic's dimension (market not
 *     sized is company.market UNKNOWN), never application.note;
 *   - Q never claims to leave something open inside a question either.
 *
 * Same variables and the same reading schema (v2) as v8.
 */
const replaced = (text: string, anchor: string, by: string): string => {
  if (!text.includes(anchor))
    throw new Error(`GATEQ_INTERVIEWER_V9: anchor moved: ${anchor}`);
  return text.replace(anchor, by);
};

let template = GATEQ_INTERVIEWER_V8.template;
template = replaced(
  template,
  "A turn where they asked you something and told you nothing about themselves records nothing: facts must be empty.",
  'A turn where they asked you something and told you nothing about themselves records nothing: facts must be empty. A request about their own answers is not a question for you: "leave it open", "please leave that disagreement open", "can you leave the stage open for Kilima?" are intent ANSWER with a LEAVE_OPEN disagreementAction, never QUESTION_FOR_Q.',
);
template = replaced(
  template,
  '- op CORRECTS with target S<n>: they said S<n> was wrong or is replaced ("actually it\'s Kenya", "sorry, 1,500 not 600"). Only S<n> gives way; every other statement stays.',
  '- op CORRECTS with target S<n>: they said S<n> was wrong or is replaced ("actually it\'s Kenya", "sorry, 1,500 not 600"). Only S<n> gives way; every other statement stays. A different figure for the same metric said without such words ("back to users: about 1,500 weekly active users" after 600) is never CORRECTS: it is DISAGREES S<n>, and you ask once which is right.',
);
template = replaced(
  template,
  '- UNKNOWN is not knowing ("I don\'t know", "not sure which is right"), with declined true for "I\'d rather not say". It never replaces anything on record: use NEW.',
  '- UNKNOWN is not knowing ("I don\'t know", "not sure which is right"), with declined true for "I\'d rather not say". It never replaces anything on record: use NEW. It goes on the dimension it is about ("we haven\'t sized the market yet" is company.market UNKNOWN), never on application.note.',
);
template = replaced(
  template,
  "- Never say something was noted, recorded or saved: the platform says what it recorded.",
  '- Never say something was noted, recorded or saved: the platform says what it recorded. Never say you are leaving something open or unresolved unless its CONTRADICTIONS line is marked (left open by them) or you return its LEAVE_OPEN action this turn, and never fold such a claim into a question ("I\'ll leave those open; what else?").',
);

export const GATEQ_INTERVIEWER_V9: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV2
> = {
  ...GATEQ_INTERVIEWER_V8,
  version: 9,
  effectiveFrom: "2026-11-15",
  changeDescription:
    "The founder's acts on the record do not depend on the turn label (live 78f8d72d5): a request to leave a disagreement open is intent ANSWER with LEAVE_OPEN, never QUESTION_FOR_Q; CORRECTS only when they say the earlier answer was wrong, otherwise a different figure is DISAGREES; an unknown goes on the dimension it is about, never application.note; no left-open claim inside a question.",
  template,
};
