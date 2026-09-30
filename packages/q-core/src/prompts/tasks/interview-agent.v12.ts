import type { PromptDefinition } from "../definition.js";
import type {
  InterviewAgentV11Result,
  InterviewAgentV11Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V11 } from "./interview-agent.v11.js";

/**
 * INTERVIEW_AGENT v12 -- v11, with who started the small talk read
 * strictly (founder live test 2026-09-30). When the person opened small
 * talk and Q played along with a question, v11 sometimes read it as Q's
 * own, which gives the longer allowance for small talk Q starts. The
 * founder's rule is about who started it.
 */
const V11_CHATTER_RULE =
  "- Set chatter in your JSON: PERSON when their latest words were small talk rather than the setup, Q when your reply itself starts or continues a light moment, NONE otherwise. Set hurt to true only when they seem put out by you.";

const V12_CHATTER_RULE =
  "- Set chatter in your JSON from THEIR latest words: PERSON whenever their latest words were small talk rather than the setup, even if you play along; Q only when their latest words were about the setup and your reply is the one that opens a light moment; NONE otherwise. Set hurt to true only when they seem put out by you.";

if (!INTERVIEW_AGENT_V11.template.includes(V11_CHATTER_RULE)) {
  throw new Error(
    "INTERVIEW_AGENT v12 edits v11's chatter rule, which v11 lost",
  );
}

export const INTERVIEW_AGENT_V12: PromptDefinition<
  InterviewAgentV11Variables,
  InterviewAgentV11Result
> = {
  ...INTERVIEW_AGENT_V11,
  version: 12,
  status: "ACTIVE",
  changeDescription:
    "Founder live test 2026-09-30: small talk is read by who started it (their words), so playing along never lengthens the person's allowance.",
  effectiveFrom: "2026-09-30",
  template: INTERVIEW_AGENT_V11.template.replace(
    V11_CHATTER_RULE,
    V12_CHATTER_RULE,
  ),
};
