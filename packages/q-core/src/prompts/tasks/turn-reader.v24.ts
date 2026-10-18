import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V24_SCHEMA_VERSION,
  TurnReaderV24ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV24Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V15_ADDRESSED } from "./turn-reader.v15.js";
import { TURN_READER_V23 } from "./turn-reader.v23.js";

/**
 * TURN_READER v24 -- v23, plus speech that was never for Q (founder live
 * 2026-10-01). An open microphone heard a name said to someone in the
 * room and a long dictation to the founder's developer; both were stored
 * as their turns, and Q later called them by the overheard name and
 * summarised the dictation. Read from meaning in any language:
 *
 *   addressedToQ    false also for dictating or drafting a message meant
 *                   for someone else, and for a name or spelling said to
 *                   another person;
 *   earlierNotForQ  true when the person tells Q that what they said
 *                   before was not for it ("wasn't talking to you").
 *
 * Code keeps those lines out of what Q reads back; nothing is deleted.
 */
export const TURN_READER_V24_ADDRESSED = `${TURN_READER_V15_ADDRESSED.trimEnd()} Dictating or drafting a message for someone else (an email, a note to a colleague or developer) is not for Q either, and nor is a name or a spelling said to another person.
EARLIER NOT FOR Q: earlierNotForQ is true when this message tells Q that what they said just before was not meant for it, in any words or language ("wasn't talking to you", "that was for my colleague", "ignore that, I was on a call"); otherwise false. It says nothing about this message itself: "wasn't talking to you, take me to Discover" is a request to Q with earlierNotForQ true.
`;

if (!TURN_READER_V23.template.includes(TURN_READER_V15_ADDRESSED)) {
  throw new Error(
    "TURN_READER v24 extends v15's addressed line, which v23 no longer carries",
  );
}

/**
 * RESULTS (QA, lead packet "give /results a Q navigation destination"):
 * named here so one reader version carries both changes. The contract's
 * destination arrives with QA's branch.
 */
const V21_DAILY_DESTINATION =
  "DAILY (The Q Daily: their own newspaper of news about their sectors, markets, deals and people they know, today's or this week's edition and its archive).";
export const TURN_READER_V24_DESTINATIONS =
  "DAILY (The Q Daily: their own newspaper of news about their sectors, markets, deals and people they know, today's or this week's edition and its archive), RESULTS (Results: what their activity on Capital Q produced -- introductions, conversations, meetings and where each stands -- with reports to download).";

if (!TURN_READER_V23.template.includes(V21_DAILY_DESTINATION)) {
  throw new Error(
    "TURN_READER v24 extends v21's DAILY destination, which changed",
  );
}

export const TURN_READER_V24: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV24Result
> = {
  ...TURN_READER_V23,
  version: 24,
  status: "DEPRECATED",
  changeDescription:
    "Founder live 2026-10-01: addressedToQ also false for dictation meant for someone else and a name said to another person; new earlierNotForQ when the person says what they said before was not for Q. Code keeps such lines out of what Q reads back. QA: names the RESULTS destination.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V24_SCHEMA_VERSION,
    schema: TurnReaderV24ResultSchema,
  },
  template: TURN_READER_V23.template
    .replace(TURN_READER_V15_ADDRESSED, TURN_READER_V24_ADDRESSED)
    .replace(V21_DAILY_DESTINATION, TURN_READER_V24_DESTINATIONS),
};
