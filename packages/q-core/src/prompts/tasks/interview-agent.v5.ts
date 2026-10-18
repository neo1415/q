import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_V5_UNTRUSTED,
  InterviewAgentV5VariablesSchema,
  type InterviewAgentResult,
  type InterviewAgentV5Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V4 } from "./interview-agent.v4.js";

/**
 * INTERVIEW_AGENT v5 — v4, continued from state rather than from a
 * provider's tool history (reliability; lead, 2026-09-25).
 *
 * A turn that one model began with tool calls could not be continued by
 * the fallback model: Gemini refuses a function-call history it did not
 * sign ("Function call is missing a thought_signature"), and the person
 * got an HTTP 503. Each round is now rendered afresh from the onboarding
 * state and the list of what Q has already done this turn, with Capital
 * Q's result for each, so any eligible model can take the next round.
 */
const DONE_ANCHOR = "When you are done, write only the JSON object";

const THIS_TURN_RULE = `- What you have already done this turn, with Capital Q's result for each, is listed at the end. Those actions have happened: never repeat one that has a result. Act only on what is still left; when nothing is, write your reply from those results.

`;

const THIS_TURN_SECTION = `
WHAT YOU HAVE ALREADY DONE THIS TURN (your actions and Capital Q's results, oldest first; empty before your first action)
{{thisTurn}}`;

if (!INTERVIEW_AGENT_V4.template.includes(DONE_ANCHOR)) {
  throw new Error("INTERVIEW_AGENT v5 extends v4, which lost an anchor");
}

export const INTERVIEW_AGENT_V5: PromptDefinition<
  InterviewAgentV5Variables,
  InterviewAgentResult
> = {
  id: INTERVIEW_AGENT_V4.id,
  kind: INTERVIEW_AGENT_V4.kind,
  taskClass: INTERVIEW_AGENT_V4.taskClass,
  owner: INTERVIEW_AGENT_V4.owner,
  output: INTERVIEW_AGENT_V4.output,
  variables: {
    schema: InterviewAgentV5VariablesSchema,
    untrusted: [...INTERVIEW_AGENT_V5_UNTRUSTED],
  },
  version: 5,
  status: "DEPRECATED",
  changeDescription:
    "Reliability: each round is rendered from the onboarding state and this turn's actions with their results, never from a provider's native tool history, so a fallback model can continue a turn another model began.",
  effectiveFrom: "2026-09-25",
  template: `${INTERVIEW_AGENT_V4.template.replace(
    DONE_ANCHOR,
    `${THIS_TURN_RULE}${DONE_ANCHOR}`,
  )}${THIS_TURN_SECTION}`,
};
