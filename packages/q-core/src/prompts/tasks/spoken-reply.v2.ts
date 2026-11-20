import { SPEAK_FROM_FACTS_V1, SPOKEN_REPLY_V1 } from "./spoken-reply.v1.js";

/**
 * SPOKEN_REPLY v2 (HQ-2, 20 Nov 2026; conversation audit §2.3): "Good one,"
 * was suggested as a reaction, which reads as reflex praise; and nothing
 * said one question a turn. The open door stays code's (`next`, given only
 * when there is one). v1's words otherwise; the duplex line's conduct uses
 * the same text (SPEAK_FROM_FACTS_V2).
 */
export const V1_REACTION =
  '- Match their energy and length: brief for brief, casual for casual. React like a person when it fits ("Right,", "So,", "Good one,"), not as a reflex, and never open with "Sure", "Got it", "Okay" or "Absolutely".';
export const V2_REACTION =
  '- Match their energy and length: brief for brief, casual for casual. React like a person when it fits ("Right,", "So,"), not as a reflex; never praise what they said, and never open with "Sure", "Got it", "Okay", "Great" or "Absolutely".';
export const V1_OPEN_DOOR =
  '- End with an open door when next is given: offer it as a short question ("want me to go through Tensorgate?"), then stop.';
export const V2_OPEN_DOOR =
  '- End with an open door only when next is given: one short question ("want me to go through Tensorgate?"), then stop. Without next, end where the answer ends. Never more than one question, and never speak as a go-between ("I\'ll ask them").';

if (
  SPEAK_FROM_FACTS_V1.split(V1_REACTION).length !== 2 ||
  SPEAK_FROM_FACTS_V1.split(V1_OPEN_DOOR).length !== 2 ||
  SPOKEN_REPLY_V1.template.split(SPEAK_FROM_FACTS_V1).length !== 2
) {
  throw new Error("SPOKEN_REPLY v2 edits v1's rules, which changed");
}

export const SPEAK_FROM_FACTS_V2 = SPEAK_FROM_FACTS_V1.replace(
  V1_REACTION,
  V2_REACTION,
).replace(V1_OPEN_DOOR, V2_OPEN_DOOR);

export const SPOKEN_REPLY_V2: typeof SPOKEN_REPLY_V1 = {
  ...SPOKEN_REPLY_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "HQ-2 (20 Nov 2026, conversation audit 2.3): no praise reaction ('Good one,' removed), an open door only when code gives next, one question at most, never a go-between. v1 otherwise unchanged.",
  effectiveFrom: "2026-11-20",
  template: SPOKEN_REPLY_V1.template.replace(
    SPEAK_FROM_FACTS_V1,
    SPEAK_FROM_FACTS_V2,
  ),
};
