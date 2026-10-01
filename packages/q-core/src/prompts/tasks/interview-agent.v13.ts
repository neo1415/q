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
 * The sections are the same, by the same names, in a different order.
 *
 * One rule is added (HANDOVER §5.6): on the typed channel, a response that
 * only writes what they said carries its reply beside the calls. Capital Q
 * uses that draft only when every write landed (interview-agent.ts,
 * everyWriteLanded); otherwise the loop shows the results and asks again,
 * exactly as before. 283 of 704 measured turns spent a second ~2 s round
 * rewriting a reply the first could have carried.
 */
const STATE_SECTION =
  "ONBOARDING STATE (trusted; the same picture get_onboarding_state returns)\n{{state}}\n\n";
const THIS_TURN_ANCHOR = "WHAT YOU HAVE ALREADY DONE THIS TURN";
const RESULT_LINE =
  'When you are done, write only the JSON object {"reply": "...", "asking": "<the stepKey your reply asks about, or null>", "raised": ["<the checkId of each check your reply puts to them>"], "chatter": "NONE" | "PERSON" | "Q", "hurt": false}.';
const DRAFT_RULE =
  "On channel text, when a response only records, recommends, corrects, sets aside or notes what they said, write that same JSON object as your text in the same response as the calls, worded for the case where every call lands. Capital Q uses it only if every call lands; otherwise you see the results and write the reply again. Never draft beside get_onboarding_state, a look-up or confirm_and_finish.";

for (const anchor of [STATE_SECTION, THIS_TURN_ANCHOR, RESULT_LINE]) {
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
  status: "DEPRECATED",
  changeDescription:
    "Latency: the onboarding state moves after the unchanging rules, next to this turn's actions, so the provider's prompt cache covers the rules on every round; on the typed channel a write-only response drafts its reply beside the calls.",
  effectiveFrom: "2026-10-01",
  template: INTERVIEW_AGENT_V12.template
    .replace(RESULT_LINE, `${RESULT_LINE}\n${DRAFT_RULE}`)
    .replace(STATE_SECTION, "")
    .replace(THIS_TURN_ANCHOR, `${STATE_SECTION}${THIS_TURN_ANCHOR}`),
};
