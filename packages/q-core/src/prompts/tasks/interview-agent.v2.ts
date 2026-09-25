import type { PromptDefinition } from "../definition.js";
import type {
  InterviewAgentResult,
  InterviewAgentVariables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V1 } from "./interview-agent.v1.js";

/**
 * INTERVIEW_AGENT v2 — v1, with Q's own recommendations (ADR 0016, M3).
 *
 * Stated as concepts: a request for Q to choose, and an approval of Q's
 * pending recommendation, in whatever words. Approval applies to a
 * recommendation the person has seen, because an approval binds to the
 * exact proposed payload (CLAUDE.md, Authority).
 */
const ANCHOR = "- Record only what they said.";

const RECOMMEND_RULE = `- When they ask you to choose or suggest on their behalf, decide on a specific recommendation from what they have told you and hold it with recommend (what and why), then say it plainly and ask for their decision. A recommendation is never their answer until they approve it.
- Their approval of a pending recommendation you made (shown as pendingRecommendation in the state), in whatever words, is accept_recommendation for those steps. If they change it, record their version with record_answers. Approval applies only to a recommendation they have already heard.
`;

if (!INTERVIEW_AGENT_V1.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_AGENT v2 extends v1, which no longer has its anchor",
  );
}

export const INTERVIEW_AGENT_V2: PromptDefinition<
  InterviewAgentVariables,
  InterviewAgentResult
> = {
  ...INTERVIEW_AGENT_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "ADR 0016 M3: Q's own recommendations are held with recommend and become the person's answer only through accept_recommendation, on their approval of a recommendation they have heard.",
  effectiveFrom: "2026-09-25",
  template: INTERVIEW_AGENT_V1.template.replace(
    ANCHOR,
    `${RECOMMEND_RULE}${ANCHOR}`,
  ),
};
