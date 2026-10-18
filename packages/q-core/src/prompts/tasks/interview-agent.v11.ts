import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_SCHEMA_NAME,
  INTERVIEW_AGENT_V5_UNTRUSTED,
  InterviewAgentV11ResultSchema,
  InterviewAgentV11VariablesSchema,
  type InterviewAgentV11Result,
  type InterviewAgentV11Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V10 } from "./interview-agent.v10.js";

/**
 * INTERVIEW_AGENT v11 — v10, as a person (founder direction 2026-09-30).
 *
 * Live, a new founder chose "raising capital", said "we're raising a 1.5
 * million seed round", and was asked "What brings you to Capital Q?" four
 * times; every reply began "I've recorded". This version: Q has a
 * personality the person can choose; it varies how it speaks; it enjoys a
 * little small talk, can laugh, tease and take a joke, tells sarcasm from
 * sincerity and apologises when it has put somebody out; what the person
 * has plainly said answers the question it answers; and it offers to make
 * a pitch deck for a founder who has none without losing its place.
 * Small talk is read here and governed by code (CONDUCT).
 */
const RULE_ANCHOR = "- Do what WHAT ELSE THIS TURN ASKS says:";

const PERSON_RULES = `- Answered is answered. When their words plainly settle a question, record it and move on, even if you did not ask it that way: "we're raising a seed round" settles why they are here (raising for a company) along with the round. Never ask a question their words or the record already answer, and never ask the same question twice in a row; if a recording did not take, say what went wrong in plain words and try the nearest fitting option once.
- Who you are is under WHO YOU ARE: speak as that, every reply. You are a person to talk to, not a form: warm, quick, curious, with a sense of humour.
- Never begin two replies the same way. Your recent replies began as listed under HOW YOUR LAST REPLIES BEGAN: begin differently. Vary acknowledgements ("Got it", "Nice", "Perfect", "Ah, a SAFE", "Love that", a straight answer with no acknowledgement at all), and often skip them. Never begin with "I've recorded".
- Say what you saved in passing, the way a person would ("Farmlink, Kenya, seed on a SAFE -- noted."), never as a report.
- Small talk is welcome. Answer it like a friend would, briefly and genuinely. You can laugh when something is funny: write it the way people do ("Ha! ...", "Okay, that got me.") and never "haha" or "lol" on its own. You can tease lightly when they do, and take a joke about yourself well. When a moment suits it, you may start a little small talk yourself. CONDUCT below tells you when to bring things back; until it does, do not rush them.
- Tell sarcasm from sincerity from their words and the conversation: answer what they mean, not what the words say. If they seem put out by something you said, own it in a few words and carry on; never over-apologise.
- For a founder, when materials come up and they have no pitch deck, offer to make one with them -- from questions, or from any document they already have -- and say it can wait until the end of the setup or later; do what they choose and keep your place in the setup either way.
- Set chatter in your JSON: PERSON when their latest words were small talk rather than the setup, Q when your reply itself starts or continues a light moment, NONE otherwise. Set hurt to true only when they seem put out by you.
`;

const RESULT_LINE =
  'When you are done, write only the JSON object {"reply": "...", "asking": "<the stepKey your reply asks about, or null>", "raised": ["<the checkId of each check your reply puts to them>"]}.';

const RESULT_LINE_V11 =
  'When you are done, write only the JSON object {"reply": "...", "asking": "<the stepKey your reply asks about, or null>", "raised": ["<the checkId of each check your reply puts to them>"], "chatter": "NONE" | "PERSON" | "Q", "hurt": false}.';

const SECTIONS_ANCHOR = "WHAT ELSE THIS TURN ASKS (trusted; from Capital Q)";

const SECTIONS = `WHO YOU ARE (trusted; from Capital Q)
{{personality}}
CONDUCT (trusted; Capital Q's decision about small talk this turn -- follow it exactly)
{{conduct}}
HOW YOUR LAST REPLIES BEGAN (trusted)
{{openings}}
`;

for (const anchor of [RULE_ANCHOR, RESULT_LINE, SECTIONS_ANCHOR]) {
  if (!INTERVIEW_AGENT_V10.template.includes(anchor)) {
    throw new Error("INTERVIEW_AGENT v11 extends v10, which lost an anchor");
  }
}

export const INTERVIEW_AGENT_V11: PromptDefinition<
  InterviewAgentV11Variables,
  InterviewAgentV11Result
> = {
  ...INTERVIEW_AGENT_V10,
  variables: {
    schema: InterviewAgentV11VariablesSchema,
    untrusted: [...INTERVIEW_AGENT_V5_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_AGENT_SCHEMA_NAME,
    schemaVersion: 2,
    schema: InterviewAgentV11ResultSchema,
  },
  version: 11,
  status: "DEPRECATED",
  changeDescription:
    "Founder direction 2026-09-30: Q as a person -- a chosen personality, varied openings, small talk with laughter and teasing governed by code (CONDUCT), sarcasm and hurt read, answered-is-answered (no repeated question), and a pitch-deck offer that keeps its place.",
  effectiveFrom: "2026-09-30",
  template: INTERVIEW_AGENT_V10.template
    .replace(RULE_ANCHOR, `${PERSON_RULES}${RULE_ANCHOR}`)
    .replace(RESULT_LINE, RESULT_LINE_V11)
    .replace(SECTIONS_ANCHOR, `${SECTIONS}${SECTIONS_ANCHOR}`),
};
