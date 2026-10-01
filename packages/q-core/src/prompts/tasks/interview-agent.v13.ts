import type { PromptDefinition } from "../definition.js";
import type {
  InterviewAgentV11Result,
  InterviewAgentV11Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V12 } from "./interview-agent.v12.js";

/**
 * INTERVIEW_AGENT v13 -- v12, ordered for the provider's prompt cache
 * (HANDOVER §5.6, latency; harden spec §3).
 *
 * A provider caches the longest unchanged prefix of a prompt. v12 put the
 * onboarding state -- which changes after every write and every turn --
 * near the top, before about 10,000 characters of rules that never
 * change, so every round paid for those rules uncached
 * (`ai_ops.model_usage`, 2026-09-29..10-01: 9,480 input tokens a dialogue
 * call, 3,083 cached; 2-5 rounds a turn). The state moves to just before
 * what Q has done this turn, the two things that change between rounds.
 * Nothing is added or removed: the same sections, by the same names, in a
 * different order.
 */
const STATE_SECTION =
  "ONBOARDING STATE (trusted; the same picture get_onboarding_state returns)\n{{state}}\n\n";
const THIS_TURN_ANCHOR = "WHAT YOU HAVE ALREADY DONE THIS TURN";

for (const anchor of [STATE_SECTION, THIS_TURN_ANCHOR]) {
  if (INTERVIEW_AGENT_V12.template.split(anchor).length !== 2) {
    throw new Error("INTERVIEW_AGENT v13 reorders v12, which lost an anchor");
  }
}

export const INTERVIEW_AGENT_V13: PromptDefinition<
  InterviewAgentV11Variables,
  InterviewAgentV11Result
> = {
  ...INTERVIEW_AGENT_V12,
  version: 13,
  status: "ACTIVE",
  changeDescription:
    "Latency: the onboarding state moves after the unchanging rules, next to this turn's actions, so the provider's prompt cache covers the rules on every round.",
  effectiveFrom: "2026-10-01",
  template: INTERVIEW_AGENT_V12.template
    .replace(STATE_SECTION, "")
    .replace(THIS_TURN_ANCHOR, `${STATE_SECTION}${THIS_TURN_ANCHOR}`),
};
