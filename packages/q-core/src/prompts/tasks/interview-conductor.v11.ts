import type { PromptDefinition } from "../definition.js";
import type {
  InterviewConductorV7Result,
  InterviewConductorV8Variables,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V10 } from "./interview-conductor.v10.js";

/**
 * INTERVIEW_CONDUCTOR v11 — v10, with questions about their own answers
 * pointed at the steps they are about (CQ-QX-005, ACC round 3 #1, #2).
 *
 * "Did gambling go in as a hard no?" was answered "yes" when nothing was
 * stored, and "did you save the 25k minimum?" was not answered at all.
 * The model now names the steps such a question is about in
 * reading.question.about; the platform answers it from what is actually
 * stored, so Q cannot claim a value it does not hold. And a turn that
 * answers and asks is read as the answer, with the question beside it —
 * never as a question alone, which is what stopped "mostly co-investing"
 * from being written.
 */
const ANCHOR = "- reading.clears:";

const RECORDS_RULE = `- A question about what they already told you ("did gambling go in?", "did you save the 25k?"): reading.question kind THEIR_OWN_RECORDS with about = the steps it concerns. The platform answers it from what is stored; never say something is recorded, taken or "the hard no" yourself. If the same turn also answers something, reading.kind is ANSWER or CORRECTION (never QUESTION_TO_Q) and the values go in answers as usual.
`;

if (!INTERVIEW_CONDUCTOR_V10.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v11 extends v10's reading rules, and v10 no longer carries the clears rule",
  );
}

export const INTERVIEW_CONDUCTOR_V11: PromptDefinition<
  InterviewConductorV8Variables,
  InterviewConductorV7Result
> = {
  ...INTERVIEW_CONDUCTOR_V10,
  version: 11,
  status: "ACTIVE",
  changeDescription:
    "CQ-QX-005 round 3: a question about their own answers names the steps it is about (reading.question.about) and the platform answers it from stored state; a turn that answers and asks is read as the answer with the question beside it.",
  effectiveFrom: "2026-09-24",
  template: INTERVIEW_CONDUCTOR_V10.template.replace(
    ANCHOR,
    `${RECORDS_RULE}${ANCHOR}`,
  ),
};
