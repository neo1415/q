import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_V5_UNTRUSTED,
  InterviewAgentV9VariablesSchema,
  type InterviewAgentResult,
  type InterviewAgentV9Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V8 } from "./interview-agent.v8.js";

/**
 * INTERVIEW_AGENT v9 — v8, with what else the turn asks (P0-1): a pause, a
 * look-up that runs after the reply, look-ups being unavailable, and a
 * corrected pronunciation. Capital Q reads these from the person's latest
 * words, independently of this model, and says what follows as trusted
 * notes; this model says it in its own words. Concepts only.
 */
const DECLINED_ANCHOR =
  "OPTIONAL STEPS THEY DECLINED (trusted; read by Capital Q from their latest words)";

const NOTES_SECTION = `WHAT ELSE THIS TURN ASKS (trusted; from Capital Q)
{{turnNotes}}
`;

const RULE_ANCHOR = "- Record only what they said";

const NOTES_RULE = `- Do what WHAT ELSE THIS TURN ASKS says: it tells you when they want to pause, when a look-up will run right after your reply, when looking things up is unavailable, and how they want a name said. When it says a look-up will run, or that they are pausing, ask no question in this reply.
`;

for (const anchor of [DECLINED_ANCHOR, RULE_ANCHOR]) {
  if (!INTERVIEW_AGENT_V8.template.includes(anchor)) {
    throw new Error("INTERVIEW_AGENT v9 extends v8, which lost an anchor");
  }
}

export const INTERVIEW_AGENT_V9: PromptDefinition<
  InterviewAgentV9Variables,
  InterviewAgentResult
> = {
  ...INTERVIEW_AGENT_V8,
  variables: {
    schema: InterviewAgentV9VariablesSchema,
    untrusted: [...INTERVIEW_AGENT_V5_UNTRUSTED],
  },
  version: 9,
  status: "ACTIVE",
  changeDescription:
    "P0-1: trusted notes on what else the turn asks — a pause, a look-up that runs after the reply, look-ups unavailable, a corrected pronunciation — read independently from the person's latest words; the legacy conductor that read them is retired.",
  effectiveFrom: "2026-09-26",
  template: INTERVIEW_AGENT_V8.template
    .replace(DECLINED_ANCHOR, `${NOTES_SECTION}${DECLINED_ANCHOR}`)
    .replace(RULE_ANCHOR, `${NOTES_RULE}${RULE_ANCHOR}`),
};
