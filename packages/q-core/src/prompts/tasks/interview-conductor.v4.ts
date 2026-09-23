import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_CONDUCTOR_SCHEMA_NAME,
  INTERVIEW_CONDUCTOR_V3_UNTRUSTED,
  INTERVIEW_CONDUCTOR_V4_SCHEMA_VERSION,
  InterviewConductorV3VariablesSchema,
  InterviewConductorV4ResultSchema,
  type InterviewConductorV3Variables,
  type InterviewConductorV4Result,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V3 } from "./interview-conductor.v3.js";

/**
 * INTERVIEW_CONDUCTOR v4 — the interview answers questions about itself
 * (QX-004 core gate §8).
 *
 * Halfway through being asked which sectors they invest in, somebody
 * asked "what sectors and product areas are there?". Q sent it away to
 * be researched, went quiet for thirty seconds, and then asked "which
 * sectors and product areas?" again as though nothing had been said. The
 * same happened to "where are we so far on this onboarding?".
 *
 * Neither question needs looking up. The options are on the step the
 * person is standing on and the progress is on their session — the
 * interview is holding both while it asks somebody to go and find them.
 *
 * So the model says which of the two they meant, in a closed field, and
 * the runtime writes the answer from the authoritative state. The model
 * reads what somebody meant; it does not get to say what is true. And
 * because the answer comes from state rather than from a provider, it
 * still arrives when every provider is down.
 */
const ANCHOR =
  "- A question about their setup, the market, Capital Q, or anything you'd need to look up: intent QUESTION_FOR_Q, the question in questionForQ, and in reply say you'll look at it. Do not answer it yourself here.";

const REPLACEMENT = `- A question about what they can choose here ("what sectors are there?", "what are my options?"): intent QUESTION_FOR_Q, answerFromState OPTIONS, questionForQ null, and a short reply introducing them — the platform appends the list. A question about how far along they are ("where are we?", "how much is left?"): intent QUESTION_FOR_Q, answerFromState PROGRESS, questionForQ null, a short reply — the platform appends what is covered and what is left. Anything else you would need to look up: intent QUESTION_FOR_Q, answerFromState null, the question in questionForQ, and in reply say you'll look at it. Do not answer that kind yourself here.`;

if (!INTERVIEW_CONDUCTOR_V3.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v4 rewrites v3's question line, and v3 no longer carries it",
  );
}

export const INTERVIEW_CONDUCTOR_V4: PromptDefinition<
  InterviewConductorV3Variables,
  InterviewConductorV4Result
> = {
  ...INTERVIEW_CONDUCTOR_V3,
  version: 4,
  // Deprecated by v5, which stops the model writing names.
  status: "DEPRECATED",
  changeDescription:
    "QX-004 core gate: a question about the step's own options or about progress is answered from the session rather than sent away to be researched. The model names which, in a closed field; the runtime writes the answer, so it arrives even with no provider available.",
  effectiveFrom: "2026-09-22",
  variables: {
    schema: InterviewConductorV3VariablesSchema,
    untrusted: [...INTERVIEW_CONDUCTOR_V3_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_CONDUCTOR_SCHEMA_NAME,
    schemaVersion: INTERVIEW_CONDUCTOR_V4_SCHEMA_VERSION,
    schema: InterviewConductorV4ResultSchema,
  },
  template: INTERVIEW_CONDUCTOR_V3.template.replace(ANCHOR, REPLACEMENT),
};
