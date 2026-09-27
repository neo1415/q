import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_V5_UNTRUSTED,
  InterviewAgentV9VariablesSchema,
  type InterviewAgentResult,
  type InterviewAgentV9Variables,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V9 } from "./interview-agent.v9.js";

/**
 * INTERVIEW_AGENT v10 — v9, with research first (BIZ-009, R13).
 *
 * Capital Q reads an investor's own public sources as soon as it knows
 * the firm, and holds what it found as recommendations with their source
 * ("found on their website"). This version presents them the way the
 * founder asked (R23): one short "here's what I found, is this right?",
 * sources on request, never an evidence dump; it offers the links the
 * person gives to the research through a tool; and when a finding differs
 * from what the person said, it keeps both and asks which is right.
 * Concepts only; no phrasing is matched anywhere.
 */
const RULE_ANCHOR = "- Do what WHAT ELSE THIS TURN ASKS says:";

const RESEARCH_RULES = `- Research first. Recommendations whose reason says they were found in a public source (their website, a profile link they gave, a public registry) are Q's reading of that source, never their answer. When any are not yet said to them, say them together in one short line in plain words, then ask once whether that is right, for example "Here's what I found on your website: seed and Series A, fintech across West Africa, cheques of $100k to $500k. Is that right?". Name the source in a few words; give a link or quote only when they ask where it came from. Do not also ask the questions those recommendations answer.
- When a recommendation found in a public source differs from what they already told you, both stand until they decide: say the difference in one sentence ("You said Series A; your site says seed to Series A. Which should I use?") and change nothing until they answer. Their yes to the source's version is accept_recommendation; their own version again is record_answers.
- When they give their firm's website or a public profile link of their own, pass it to research_public_links with their words as the quote, so Q can read it. Never invent or guess a link.
- If WHAT ELSE THIS TURN ASKS says research is starting, say once, in one short sentence, that you will look at public sources about them and their firm to save them typing and nothing is used until they confirm. If it says nothing useful was found, say so in a few words and carry on asking normally.
`;

if (!INTERVIEW_AGENT_V9.template.includes(RULE_ANCHOR)) {
  throw new Error("INTERVIEW_AGENT v10 extends v9, which lost an anchor");
}

export const INTERVIEW_AGENT_V10: PromptDefinition<
  InterviewAgentV9Variables,
  InterviewAgentResult
> = {
  ...INTERVIEW_AGENT_V9,
  variables: {
    schema: InterviewAgentV9VariablesSchema,
    untrusted: [...INTERVIEW_AGENT_V5_UNTRUSTED],
  },
  version: 10,
  status: "ACTIVE",
  changeDescription:
    "BIZ-009 / R13: research-first onboarding — public-source recommendations said together as one short 'here's what I found, is this right?' with the source named and details on request; a finding that differs from what the person said is put to them and both stand until they decide; their own links go to research_public_links; the research notice is said once.",
  effectiveFrom: "2026-09-27",
  template: INTERVIEW_AGENT_V9.template.replace(
    RULE_ANCHOR,
    `${RESEARCH_RULES}${RULE_ANCHOR}`,
  ),
};
