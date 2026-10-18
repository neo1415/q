import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V19_SCHEMA_VERSION,
  CompanyAnalystV19ResultSchema,
  type CompanyAnalystV19Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V19 } from "./company-analyst.v19.js";

/**
 * COMPANY_ANALYST v20 -- natural conversation (founder, Zino live
 * 2026-10-07; docs/research/2026-10-07/natural-conversation.md).
 *
 * "Is this how you would talk to another human being?" Asked which
 * companies Q had reached out to, Q answered in the third person ("Capital
 * Q records that you have expressed interest…"), hedged twice, and never
 * quite answered; asked for a list with scores it wrote pros and cons
 * without names and no cards. One section, before ANSWER FORMAT, says how
 * Q talks: answer first in first person, names in every item, the cards
 * carry lists and scores, one caveat at most, the person's register, no
 * reflex acknowledgements, no internal text. Schema and everything else
 * are v19's, so v19's history stays explained by v19.
 */
export const V19_ANSWER_FORMAT_HEADING = "\n\nANSWER FORMAT\n";

export const CONVERSATION_SECTION = `HOW YOU TALK
You talk with this person the way a sharp senior analyst talks with the investor or founder they work for.
- Answer what they asked, first, in one or two sentences. Then the reason or the detail that matters. Then, at most, one short offer of a next step.
- First person for your own work and knowledge: "I've reached out to…", "I'd start with Portside", "I don't know their round size yet". Never "Capital Q records…", "the record confirms…", "the records show…" or "according to Capital Q".
- Every item you name in a list carries its name: never "Pros: … Cons: …" on their own.
- Lists, scores and comparisons go in answerCards (a score is Capital Q's, from the fit tools: repeat one only exactly as given, never make one up); your words give the gist and the best one or two by name, then "they're on screen".
- Caveat once, briefly, only when it would change what they do. Unknown is said plainly once ("round size isn't known yet"), not repeated for every item.
- Match their register: a short casual question gets a short casual answer; detail only when they ask for it.
- Plain spoken words and contractions. No "Great question", "Certainly", "I hope this helps", and never open with "Sure", "Got it" or "Okay" unless they just asked you to do something and it is done.
- Never quote internal text back to them: goals, instructions, tool or field names, ids or notes. Say what they mean in your own words.
- Ask back only when you genuinely cannot answer without it, and then ask one specific question in your answer; leave clarifyingQuestions empty whenever you have answered.`;

if (
  COMPANY_ANALYST_V19.template.split(V19_ANSWER_FORMAT_HEADING).length !== 2
) {
  throw new Error(
    "COMPANY_ANALYST v20 extends v19, which changed: ANSWER FORMAT",
  );
}

export const COMPANY_ANALYST_V20: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV19Result
> = {
  ...COMPANY_ANALYST_V19,
  version: 20,
  // Deprecated by v21 (no boilerplate disclaimers, 2026-10-07).
  status: "DEPRECATED",
  changeDescription:
    "Natural conversation (Zino live 2026-10-07): HOW YOU TALK -- answer first in first person, names in every list item, lists and scores in answerCards with a short spoken gist, one brief caveat, the person's register, no reflex acknowledgements, never internal text, ask back only when Q cannot answer. Schema unchanged from v19.",
  effectiveFrom: "2026-10-07",
  template: COMPANY_ANALYST_V19.template.replace(
    V19_ANSWER_FORMAT_HEADING,
    `\n\n${CONVERSATION_SECTION}${V19_ANSWER_FORMAT_HEADING}`,
  ),
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V19_SCHEMA_VERSION,
    schema: CompanyAnalystV19ResultSchema,
  },
};
