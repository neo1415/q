import type { PromptDefinition } from "../definition.js";
import type {
  InterviewAgentResult,
  InterviewAgentV7Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V7 } from "./interview-agent.v7.js";

/**
 * INTERVIEW_AGENT v8 — v7, with consistency checks (founder live test,
 * 2026-09-25: "angel, pre-seed, €50,000–€100 million, typical €3 million"
 * passed without a word).
 *
 * Code computes the checks and lists them in the state; Q puts each to
 * the person once, as a question with the values, and records what they
 * decide: a changed value, or confirm_as_stated. Q never corrects a value
 * itself. The reply names the checks it raised, so code keeps them from
 * being raised again. Concepts only.
 */
const RULE_ANCHOR = "- Record only what they said";

const CHECK_RULE = `- The state's checks are inconsistencies Capital Q found in what is on the record. Put each check that is not yet raised to them once, briefly and plainly, with the values, as a question; never correct a value yourself, never assume which value is wrong, and never raise a check again once raised. If they change a value, record the change; if they say the values are right, use confirm_as_stated with that check's id.
`;

const DONE_V1 = `When you are done, write only the JSON object {"reply": "...", "asking": "<the stepKey your reply asks about, or null>"}.`;
const DONE_V8 = `When you are done, write only the JSON object {"reply": "...", "asking": "<the stepKey your reply asks about, or null>", "raised": ["<the checkId of each check your reply puts to them>"]}.`;

for (const anchor of [RULE_ANCHOR, DONE_V1]) {
  if (!INTERVIEW_AGENT_V7.template.includes(anchor)) {
    throw new Error("INTERVIEW_AGENT v8 extends v7, which lost an anchor");
  }
}

export const INTERVIEW_AGENT_V8: PromptDefinition<
  InterviewAgentV7Variables,
  InterviewAgentResult
> = {
  ...INTERVIEW_AGENT_V7,
  version: 8,
  status: "DEPRECATED",
  changeDescription:
    "Consistency checks: code lists inconsistencies in what is on the record; Q raises each once as a question with the values, never corrects a value, records a change or confirm_as_stated, and names the checks it raised.",
  effectiveFrom: "2026-09-25",
  template: INTERVIEW_AGENT_V7.template
    .replace(RULE_ANCHOR, `${CHECK_RULE}${RULE_ANCHOR}`)
    .replace(DONE_V1, DONE_V8),
};
