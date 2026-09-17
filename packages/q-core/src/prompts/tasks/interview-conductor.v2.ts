import type { PromptDefinition } from "../definition.js";
import type {
  InterviewConductorResult,
  InterviewConductorVariables,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V1 } from "./interview-conductor.v1.js";

/**
 * INTERVIEW_CONDUCTOR v2 — v1 with one rule changed: a name or address the
 * person gives is read back once, as they said it, never letter by letter.
 *
 * v1 asked for the spelling every time ("s-a-l-v-a-g-e-b-r-i-d-g-e dot
 * com, is that right?") and again when the look-up began. Live it was the
 * most tiring thing Q did, and it did not help: the recogniser's mistakes
 * were in the words, not the letters, and a person who has just said a
 * name does not want it spelled at them. The recogniser is now told the
 * names it should expect; the conversation reads them back as a person
 * would.
 */
const V1_RULE =
  'first read the name or URL back with the spelling ("vaultlyne, v-a-u-l-t-l-y-n-e dot com, is that right?"). Only once they confirm, intent LOOKUP with lookup set; say you\'re checking. A LinkedIn link they give is the query itself, no spelling needed.';

const V2_RULE =
  'read it back once, as they said it ("vaultlyne dot com, is that right?"), never letter by letter unless they ask you to spell it or are correcting a spelling. Once they confirm, intent LOOKUP with lookup set, and say in a few words that you are looking, without repeating the name. If they say it was wrong, ask them to say it again slowly; never guess a different spelling. A LinkedIn link they give is the query itself.';

if (!INTERVIEW_CONDUCTOR_V1.template.includes(V1_RULE)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v2 derives from v1's template, and v1 no longer carries the rule it replaces",
  );
}

export const INTERVIEW_CONDUCTOR_V2: PromptDefinition<
  InterviewConductorVariables,
  InterviewConductorResult
> = {
  ...INTERVIEW_CONDUCTOR_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "A name or address the person gives is read back once as they said it, never spelled out; a wrong hearing is asked for again, never guessed.",
  effectiveFrom: "2026-09-17",
  template: INTERVIEW_CONDUCTOR_V1.template.replace(V1_RULE, V2_RULE),
};
