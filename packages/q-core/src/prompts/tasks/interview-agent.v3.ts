import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_V3_UNTRUSTED,
  InterviewAgentV3VariablesSchema,
  type InterviewAgentResult,
  type InterviewAgentV3Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V2 } from "./interview-agent.v2.js";

/**
 * INTERVIEW_AGENT v3 — v2, with memory in the loop (P0-5).
 *
 * What Q remembers about the person and a bounded summary of the older
 * turns arrive as untrusted context; a communication preference the
 * person states is kept through note_preference, so it holds from the next
 * turn and, when they mean it to, beyond this conversation. Concepts only.
 */
const RULE_ANCHOR = "- Record only what they said.";

const MEMORY_RULE = `- A preference they state about how you communicate (length, tone, how many questions, how plainly) is kept with note_preference, their own words as the quote; it applies from then on. It changes how you speak, never what is recorded.
- What you remember about them from earlier conversations is context for how to talk and what to ask; it is never an answer on the record and never overrides what they say now.
`;

const CONVERSATION_ANCHOR = "CONVERSATION SO FAR";

const CONTEXT_SECTIONS = `WHAT YOU REMEMBER ABOUT THEM
{{memory}}
EARLIER IN THIS CONVERSATION (summary of older turns)
{{earlier}}
`;

for (const anchor of [RULE_ANCHOR, CONVERSATION_ANCHOR]) {
  if (!INTERVIEW_AGENT_V2.template.includes(anchor)) {
    throw new Error(`INTERVIEW_AGENT v3 extends v2, which lost "${anchor}"`);
  }
}

export const INTERVIEW_AGENT_V3: PromptDefinition<
  InterviewAgentV3Variables,
  InterviewAgentResult
> = {
  id: INTERVIEW_AGENT_V2.id,
  kind: INTERVIEW_AGENT_V2.kind,
  taskClass: INTERVIEW_AGENT_V2.taskClass,
  owner: INTERVIEW_AGENT_V2.owner,
  output: INTERVIEW_AGENT_V2.output,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "P0-5: what Q remembers about the person and a bounded summary of older turns arrive as untrusted context; stated communication preferences are kept with note_preference.",
  effectiveFrom: "2026-09-25",
  variables: {
    schema: InterviewAgentV3VariablesSchema,
    untrusted: [...INTERVIEW_AGENT_V3_UNTRUSTED],
  },
  template: INTERVIEW_AGENT_V2.template
    .replace(RULE_ANCHOR, `${MEMORY_RULE}${RULE_ANCHOR}`)
    .replace(CONVERSATION_ANCHOR, `${CONTEXT_SECTIONS}${CONVERSATION_ANCHOR}`),
};
