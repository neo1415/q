import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV36Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import {
  COMPANY_ANALYST_V37,
  V37_RULES_END_BEFORE,
} from "./company-analyst.v37.js";

/**
 * v38 (HQ-2, 20 Nov 2026; conversation audit §2.3, §2.6). The conversation
 * rules, as edits inside v37's fixed (shared, cached) rules; the boundary,
 * the schema and the variables are v37's, so the cached prefix moves once.
 * The prompt stays inside its token budget (prompts.test.ts): two lines
 * that only repeated other rules pay for the additions.
 *
 * - One question a turn: "clarifyingQuestions: at most three" contradicted
 *   "one specific question" in the same prompt. Now at most one, and code
 *   shows only the first (result-blocks.ts).
 * - Reflect, then ask, with the default Q would take.
 * - No automatic closing offer: "Then, at most, one short offer of a next
 *   step" ended nearly every answer with one. An offer ends a reply only
 *   where THIS TURN allows it (code decides, and drops a trailing offer
 *   otherwise: HOW YOU END A REPLY in the turn's notes).
 * - Certainty said by the evidence class, once; never a percentage.
 * - No praise, no go-between phrasing.
 */
export const V37_ENDING =
  "Then the reason or the detail that matters. Then, at most, one short offer of a next step.";
export const V38_ENDING =
  "Then the reason or the detail that matters; offer a next step only where THIS TURN allows.";
export const V37_ASK_BACK =
  "- Ask back only when you can't answer without it: one specific question, in your answer; else clarifyingQuestions empty.";
export const V38_ASK_BACK =
  "- Ask back only when you can't answer without it: what you understood, then one question with your default, in your answer; else clarifyingQuestions empty.";
export const V37_CLARIFYING =
  "clarifyingQuestions: at most three questions that would change the answer.";
export const V38_CLARIFYING =
  "clarifyingQuestions: at most one, the one that would change the answer most.";
export const V37_CAVEAT =
  '- Caveat once, briefly, only when it would change what they do. Unknown is said plainly once ("round size isn\'t known yet"), not for every item.';
export const V38_CAVEAT =
  '- Caveat once, only if it changes what they do; sureness by evidence (their own figure, a document, your read), never a %; unknown once ("round size isn\'t known yet").';
export const V37_PLAIN_WORDS =
  '- Plain spoken words and contractions. No "Great question", "Certainly", "I hope this helps", and never open with "Sure", "Got it" or "Okay" unless they asked for something and it is done.';
export const V38_PLAIN_WORDS = `${V37_PLAIN_WORDS} Never praise them or relay ("I'll ask them").`;
/** Repeats HOW YOU TALK's "never name your inputs (… F-labels)". */
export const V37_REF_LABEL = "Never write a ref label (F1) in the answer.\n";
/** Repeats the clarifyingQuestions rule above. */
export const V37_CLARIFYING_KEY =
  "; clarifyingQuestions asks for needed information.";

const template = COMPANY_ANALYST_V37.template;
for (const [part, name] of [
  [V37_ENDING, "the ending"],
  [V37_ASK_BACK, "the ask-back rule"],
  [V37_CLARIFYING, "the clarifyingQuestions rule"],
  [V37_CAVEAT, "the caveat rule"],
  [V37_PLAIN_WORDS, "the plain words rule"],
  [V37_REF_LABEL, "the ref label line"],
  [V37_CLARIFYING_KEY, "the clarifyingQuestions key note"],
  [V37_RULES_END_BEFORE, "the rules boundary"],
] as const) {
  if (template.split(part).length !== 2) {
    throw new Error(`COMPANY_ANALYST v38 edits v37's ${name}, which changed`);
  }
}

export const COMPANY_ANALYST_V38: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV36Result
> = {
  ...COMPANY_ANALYST_V37,
  version: 38,
  status: "ACTIVE",
  changeDescription:
    "HQ-2 (20 Nov 2026, conversation audit 2.3 and 2.6): one question a turn (clarifyingQuestions at most one, was three), reflect then ask with the default, an offer only where the turn allows, certainty by evidence class, no praise or relay. Edits inside v37's shared fixed rules, paid for by two repeated lines; schema and variables unchanged.",
  effectiveFrom: "2026-11-20",
  template: template
    .replace(V37_ENDING, V38_ENDING)
    .replace(V37_ASK_BACK, V38_ASK_BACK)
    .replace(V37_CLARIFYING, V38_CLARIFYING)
    .replace(V37_CAVEAT, V38_CAVEAT)
    .replace(V37_PLAIN_WORDS, V38_PLAIN_WORDS)
    .replace(V37_REF_LABEL, "")
    .replace(V37_CLARIFYING_KEY, "."),
};
