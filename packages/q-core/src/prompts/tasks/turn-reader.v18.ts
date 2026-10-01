import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V17 } from "./turn-reader.v17.js";

/**
 * TURN_READER v18 -- v17, where accepting Q's offer is asking for it
 * (founder direction 2026-10-01: Q offers the next step "and actually does
 * it"; harden spec §4). Every Home Q reply now ends with one offer of
 * something Capital Q can do ("Want me to make the deck?"); a plain "yes,
 * go ahead" to it was an ANSWER, so the action the offer named was never
 * started. It is read now as the request the offer described, with the
 * same kind, tool and fields. Approval is unchanged: anything that acts
 * still waits for the person's one-tap approval.
 */
const V17_ANSWER =
  "- ANSWER: they answer a question Q just asked (see RECENT TURNS).";

const V18_ANSWER = `- ANSWER: they answer a question Q just asked (see RECENT TURNS).
- When THIS message only accepts something Q offered to do in its last turn (yes, go ahead, do it, sure, please) -- or accepts it with a change ("yes, but shorter") -- read it as if they had asked for exactly what Q offered, with that change: the kind, tool, documentType and other fields that request would have, their words as text. Accepting an offer to do something is never ANSWER. A yes to a question that offered nothing to do is ANSWER.`;

if (!TURN_READER_V17.template.includes(V17_ANSWER)) {
  throw new Error("TURN_READER v18 extends v17's ANSWER kind, which v17 lost");
}

export const TURN_READER_V18: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V17,
  version: 18,
  status: "ACTIVE",
  changeDescription:
    "Founder direction 2026-10-01: accepting what Q offered to do in its last turn reads as the request it offered, not as an answer.",
  effectiveFrom: "2026-10-01",
  template: TURN_READER_V17.template.replace(V17_ANSWER, V18_ANSWER),
};
