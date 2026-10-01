import type { PromptDefinition } from "../definition.js";
import type {
  InterviewAgentV11Result,
  InterviewAgentV11Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V14 } from "./interview-agent.v14.js";

/**
 * INTERVIEW_AGENT v15 -- v14 without the reply drafted beside the writes
 * (lead decision 2026-10-01). Neither text beside calls (v13) nor a
 * write_reply call (v14) was ever produced live: 0 of 19 bench turns each
 * time. The rule and its code path are removed; the cache-ordered layout
 * v13 introduced stays.
 */
const V14_DRAFT_LINE =
  "\nWhen write_reply is offered and a response only records, recommends, corrects, sets aside or notes what they said, call write_reply in that same response with your reply, worded for the case where every other call lands. Capital Q uses it only if every call lands; otherwise you see the results and reply again. Never call write_reply beside get_onboarding_state, a look-up or confirm_and_finish. With nothing to record, you may reply with write_reply alone or as the JSON object.";

if (!INTERVIEW_AGENT_V14.template.includes(V14_DRAFT_LINE)) {
  throw new Error(
    "INTERVIEW_AGENT v15 removes v14's draft rule, which v14 lost",
  );
}

export const INTERVIEW_AGENT_V15: PromptDefinition<
  InterviewAgentV11Variables,
  InterviewAgentV11Result
> = {
  ...INTERVIEW_AGENT_V14,
  version: 15,
  // Deprecated by v16 (PRESENCE gestures, 2026-10-01).
  status: "DEPRECATED",
  changeDescription:
    "Lead decision 2026-10-01: the drafted-reply rule is removed (0 of 19 live turns used it); v13's cache-ordered layout stays.",
  effectiveFrom: "2026-10-01",
  template: INTERVIEW_AGENT_V14.template.replace(V14_DRAFT_LINE, ""),
};
