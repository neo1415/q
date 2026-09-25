import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_V5_UNTRUSTED,
  InterviewAgentV7VariablesSchema,
  type InterviewAgentResult,
  type InterviewAgentV7Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V6 } from "./interview-agent.v6.js";

/**
 * INTERVIEW_AGENT v7 — v6, with declines set aside (ACC 2026-09-25).
 *
 * On a category step Q said it could not record "no preference" and told
 * the person to say "skip": a word the person had to learn. A decline of
 * an optional step is an answer; Capital Q reads it from their latest
 * words, lists it as trusted input, and Q sets the step aside with
 * set_aside. Concepts only.
 */
const HANDED_ANCHOR =
  "CHOICES HANDED TO YOU (trusted; read by Capital Q from their latest words)";

const DECLINED_SECTION = `OPTIONAL STEPS THEY DECLINED (trusted; read by Capital Q from their latest words)
{{declined}}
`;

const RULE_ANCHOR = "- Record only what they said";

const DECLINE_RULE = `- An optional step listed under OPTIONAL STEPS THEY DECLINED is answered: set it aside with set_aside, their words as the quote, say so in passing, and do not ask it again. Unknown stays unknown: a decline is never recorded as a value. Never ask them to use a particular word or command to decline anything.
`;

for (const anchor of [HANDED_ANCHOR, RULE_ANCHOR]) {
  if (!INTERVIEW_AGENT_V6.template.includes(anchor)) {
    throw new Error("INTERVIEW_AGENT v7 extends v6, which lost an anchor");
  }
}

export const INTERVIEW_AGENT_V7: PromptDefinition<
  InterviewAgentV7Variables,
  InterviewAgentResult
> = {
  id: INTERVIEW_AGENT_V6.id,
  kind: INTERVIEW_AGENT_V6.kind,
  taskClass: INTERVIEW_AGENT_V6.taskClass,
  owner: INTERVIEW_AGENT_V6.owner,
  output: INTERVIEW_AGENT_V6.output,
  variables: {
    schema: InterviewAgentV7VariablesSchema,
    untrusted: [...INTERVIEW_AGENT_V5_UNTRUSTED],
  },
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "Declines as answers: optional steps the person declined, read from their latest words, are listed as trusted input and set aside with set_aside; Q never asks for a particular word to decline.",
  effectiveFrom: "2026-09-25",
  template: INTERVIEW_AGENT_V6.template
    .replace(HANDED_ANCHOR, `${DECLINED_SECTION}${HANDED_ANCHOR}`)
    .replace(RULE_ANCHOR, `${DECLINE_RULE}${RULE_ANCHOR}`),
};
