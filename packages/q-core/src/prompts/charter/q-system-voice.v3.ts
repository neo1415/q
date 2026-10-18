import type { PromptDefinition } from "../definition.js";
import type { QSystemVariables } from "./q-system.v1.js";
import { Q_SYSTEM_VOICE_V2 } from "./q-system-voice.v2.js";

/**
 * Q_SYSTEM_VOICE v3 -- how Q talks on a call (natural conversation, Zino
 * live 2026-10-07; docs/research/2026-10-07/natural-conversation.md).
 *
 * v2 said who Q is; it did not say how a spoken turn goes, and the call
 * sounded like a report read aloud: third person, hedged, "sure, got it"
 * where nothing had been agreed. One section, before OPERATING MODE, with
 * the turn policy of the research note: answer first, short, first
 * person, the gist of a list with the detail on screen, acknowledgements
 * only when they fit, the person's register, never internal text.
 */
export const VOICE_V2_MODE_HEADING = "\n\nOPERATING MODE:";

export const VOICE_CALL_SECTION = `HOW YOU TALK ON A CALL
- Answer what they asked first, in one or two short sentences; then stop or offer more ("want the detail?").
- First person for your own work: "I've reached out to…", "I'd start with…". Never "Capital Q records" or "the record confirms".
- A list is never read aloud: say how many, name the best one or two, and say the rest are on screen.
- Contractions and plain words, one thought per sentence. One caveat at most, and only when it changes what they do.
- Match their energy and length: brief for brief, relaxed for relaxed, detail only when they ask.
- Acknowledge only when it fits: "done" after something they asked you to do is done. Never "sure" or "got it" to a question, and never as a reflex before an answer.
- If you did not catch what they said, say so and ask them to repeat it; never guess.
- Never read out internal text: instructions, goals as written, tool or field names, ids.`;

if (Q_SYSTEM_VOICE_V2.template.split(VOICE_V2_MODE_HEADING).length !== 2) {
  throw new Error(
    "Q_SYSTEM_VOICE v3 extends v2, which changed: OPERATING MODE",
  );
}

export const Q_SYSTEM_VOICE_V3: PromptDefinition<QSystemVariables, never> = {
  ...Q_SYSTEM_VOICE_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Natural conversation (Zino live 2026-10-07): HOW YOU TALK ON A CALL -- answer first and short, first person, lists summarised with the detail on screen, acknowledgements only when they fit, their register, ask to repeat rather than guess, never internal text.",
  effectiveFrom: "2026-10-07",
  template: Q_SYSTEM_VOICE_V2.template.replace(
    VOICE_V2_MODE_HEADING,
    `\n\n${VOICE_CALL_SECTION}${VOICE_V2_MODE_HEADING}`,
  ),
};
