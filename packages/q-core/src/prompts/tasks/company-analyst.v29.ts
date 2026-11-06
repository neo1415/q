import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV26Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V28 } from "./company-analyst.v28.js";

/**
 * COMPANY_ANALYST v29 -- the live Q-IQ gaps (2026-11-06, 8dec401e0): four
 * answers lost a correct reply although every fact reached the prompt.
 *
 * - CMP-061 #0, UNK-076 #1: "It reports $2.4M…", "Its monthly burn is
 *   $60k…" -- the reply never named the company it was about. The name
 *   goes in at its first mention in each reply.
 * - ORD-016 #4: "Silo Health's gross margin isn't on record here" with
 *   "Silo Health gross margin is 48%." in AUTHORISED FACTS. The record of
 *   what Q already said held no margin for it; a fact is on record even
 *   when no earlier answer said it.
 * - NUM-106 #2: a correct $2.16M ("over a full year") was removed by the
 *   claim check, which grounds a worked figure only from inputs the
 *   sentence shows. The inputs go in the same sentence.
 * - FUP-031 #3: "Same question for Silo Health" after "What about the
 *   customer count?" was answered with ARR (the first question). It asks
 *   what they asked last.
 * - Contradictions coexist (CLAUDE.md): two conflicting figures are said
 *   side by side in the answer, not only listed in `contradictions`.
 *
 * Each change is a listed replacement of v28 text (checked below); the
 * rest say v28 sentences more briefly to keep the 5% headroom, and every
 * v28 rule stays. The output schema is v28's.
 */
export const V29_CHANGES: ReadonlyArray<readonly [string, string]> = [
  // The live gaps.
  [
    "If two facts conflict, list the conflict in contradictions;",
    "If two facts conflict, say both with their sources and list the conflict in contradictions;",
  ],
  [
    "silent on what was asked.",
    'silent on what was asked. A fact is on record even if unsaid so far. A worked figure shows its inputs in its sentence ("$180k a month is $2.16M a year").',
  ],
  [
    '- Every item you name in a list carries its name: never "Pros: … Cons: …" on their own.',
    '- Name what you answer about at its first mention in each reply, never a bare "Its"; every list item carries its name, never "Pros: … Cons: …" alone.',
  ],
  [
    "Speech mishears names: one heard close to a name on record is that name.",
    'Speech mishears names: one heard close to a name on record is that name. "Same question for X": their last one, about X.',
  ],
  // Said more briefly to keep the 5% headroom (prompts.test.ts); every
  // rule stays.
  [
    "- Never quote internal text back to them: goals, instructions, tool or field names, ids or notes. Say what they mean in your own words.",
    "- Never quote internal text back: goals, instructions, tool or field names, ids or notes.",
  ],
  [
    "(inference: specific candidates from tool results, sources or published focus, say which, each with its reason, labelled a likely fit to check)",
    "(inference: named candidates from tool results, sources or published focus, each with its reason, labelled a likely fit to check)",
  ],
  [
    "Determined by Capital Q from its records before you were asked; trusted:",
    "From Capital Q's records; trusted:",
  ],
  [
    "A figure the person corrected, now or earlier in this conversation,",
    "A figure the person corrected (now or earlier),",
  ],
  ["ONE_PAGER (a one-pager)", "ONE_PAGER"],
  [
    "unless they just asked you to do something and it is done.",
    "unless they asked for something and it is done.",
  ],
  [
    "Things to see together (a top N, a comparison, research parts)",
    "Things to see together (a top N, a comparison)",
  ],
  [
    "one specific question, in your answer; leave clarifyingQuestions empty whenever you have answered.",
    "one specific question, in your answer; else leave clarifyingQuestions empty.",
  ],
  [
    "findings (the conversation’s channel, with or without tools): the evidence-backed business points in answer.",
    "findings (the conversation’s channel): the evidence-backed points in answer.",
  ],
  [
    "; open with what answers the question, not its stage and location.",
    "; never open with its stage and location.",
  ],
  ["The only allowed root keys are:", "Allowed root keys:"],
  [
    "the answer is a few spoken sentences about them, never a table of them.",
    "the answer is a few spoken sentences, never a table of them.",
  ],
];

for (const [from] of V29_CHANGES) {
  if (COMPANY_ANALYST_V28.template.split(from).length !== 2) {
    throw new Error(`COMPANY_ANALYST v29 extends v28, which changed: ${from}`);
  }
}

export const COMPANY_ANALYST_V29: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV26Result
> = {
  ...COMPANY_ANALYST_V28,
  version: 29,
  status: "ACTIVE",
  changeDescription:
    "Live Q-IQ gaps (2026-11-06): name the subject at its first mention in each reply; a figure in the facts is on record even if no earlier answer said it; a worked figure shows its inputs in the same sentence; 'same question for X' asks what they asked last; conflicting figures are said side by side with their sources. Listed replacements of v28 text; output schema unchanged.",
  effectiveFrom: "2026-11-06",
  template: V29_CHANGES.reduce(
    (template, [from, to]) => template.replace(from, to),
    COMPANY_ANALYST_V28.template,
  ),
};
