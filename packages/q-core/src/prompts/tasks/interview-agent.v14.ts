import type { PromptDefinition } from "../definition.js";
import type {
  InterviewAgentV11Result,
  InterviewAgentV11Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V13 } from "./interview-agent.v13.js";

/**
 * INTERVIEW_AGENT v14 -- v13, with the reply drafted beside the writes as
 * a tool call (HANDOVER §5.6).
 *
 * v13 asked for the reply as text in the same response as the calls. Live
 * (bench, 2026-10-01) the model never did: of nine turns, four were
 * write-only and all still took a second round. Models make parallel tool
 * calls readily and text beside calls rarely, so the draft is now a call
 * to write_reply. Capital Q still uses it only when every other call in
 * the response landed; otherwise the loop shows the results and asks for
 * the reply again, exactly as before.
 */
const V13_DRAFT_RULE =
  "On channel text, when a response only records, recommends, corrects, sets aside or notes what they said, write that same JSON object as your text in the same response as the calls, worded for the case where every call lands. Capital Q uses it only if every call lands; otherwise you see the results and write the reply again. Never draft beside get_onboarding_state, a look-up or confirm_and_finish.";

const V14_DRAFT_RULE =
  "When write_reply is offered and a response only records, recommends, corrects, sets aside or notes what they said, call write_reply in that same response with your reply, worded for the case where every other call lands. Capital Q uses it only if every call lands; otherwise you see the results and reply again. Never call write_reply beside get_onboarding_state, a look-up or confirm_and_finish. With nothing to record, you may reply with write_reply alone or as the JSON object.";

if (!INTERVIEW_AGENT_V13.template.includes(V13_DRAFT_RULE)) {
  throw new Error("INTERVIEW_AGENT v14 edits v13's draft rule, which v13 lost");
}

export const INTERVIEW_AGENT_V14: PromptDefinition<
  InterviewAgentV11Variables,
  InterviewAgentV11Result
> = {
  ...INTERVIEW_AGENT_V13,
  version: 14,
  status: "ACTIVE",
  changeDescription:
    "Latency, live 2026-10-01: the reply beside write-only calls is a write_reply call, which the model makes in parallel; text beside calls never came.",
  effectiveFrom: "2026-10-01",
  template: INTERVIEW_AGENT_V13.template.replace(
    V13_DRAFT_RULE,
    V14_DRAFT_RULE,
  ),
};
