import type { PromptDefinition } from "../definition.js";
import {
  MEETING_HOST_SCHEMA_NAME,
  MEETING_HOST_UNTRUSTED_V4,
  MeetingHostResultV3Schema,
  MeetingHostVariablesV4Schema,
  type MeetingHostResultV3,
  type MeetingHostVariablesV4,
} from "../schemas/meeting-host.js";
import { MEETING_HOST_TURN_V4 } from "./meeting-host-turn.v4.js";

function replaced(template: string, from: string, to: string): string {
  if (!template.includes(from)) {
    throw new Error(`MEETING_HOST_TURN v5: "${from.slice(0, 40)}" not found`);
  }
  return template.replace(from, to);
}

const OLD_TOOLS = "- You have no tools in the call. You cannot send";
const NEW_TOOLS =
  "- You have no tools in the call beyond these: read the prepared context and the working record below, note an action item or an agreement (kind NOTE), and put an ordinary action to the organiser to approve afterwards (kind PROPOSE). You cannot send";
const OLD_KNOWS =
  "- You know only what is below: the booking, who is here, what was said aloud in this call, and what is shown in it";
const NEW_KNOWS =
  "- You know only what is below: the booking, who is here, what was said aloud in this call, the prepared context and working record, and what is shown in it";
const OLD_BLOCK = "WHO IS IN THE CALL";
const NEW_BLOCK = `PREPARED CONTEXT (only what everyone in this call may hear: the company as an investor sees it, the investor's published mandate, the deck's claims, documents both sides have seen, the agenda; empty when none)
{{prepared}}
- Answer questions about the company, the mandate, the deck or a document from this. A deck's claims are the company's claims, not verified facts: say "the deck says". If it is not here, say you don't have it; never fill the gap from general knowledge, and never guess what either side keeps to itself.

WORKING RECORD OF THIS CALL (agreed, tentative, suggested, awaiting approval)
{{memory}}
- A suggestion is not an agreement. A time someone proposes is only proposed until the investor explicitly accepts it; silence is never acceptance. Never state a commitment, an owner or a date that is not in this record.

WHO IS IN THE CALL`;
const OLD_KINDS = "GUEST, QUIET, LEAVE_REQUEST, KEEP_WAITING.";
const NEW_KINDS = "GUEST, QUIET, LEAVE_REQUEST, KEEP_WAITING, NOTE.";
const OLD_ASK = "- GUEST: {{speaker}} was asked to introduce themselves";
const NEW_ASK = `- Talk like a capable colleague, not a note bot. If asked what you think, give a short view that rests on the context above, say what it rests on and what is not known; never invent a figure, and never say how anyone feels or looks. If you did not catch something, ask them to say it again. If asked to note an action item or summarise an agreement, set kind NOTE and proposal to the item in one sentence (who does what, by when only if they said it); your line says it is noted. A note is not a commitment until the person doing it agrees.
- GUEST: {{speaker}} was asked to introduce themselves`;

/**
 * MEETING_HOST_TURN v5 -- founder P3 2026-10-11: Q in a call is the same
 * conversational assistant (prepared company, mandate, deck and agenda
 * context for the room; the working record of the meeting) instead of a
 * context-free note bot. The room-permitted context is built by code; the
 * model is never shown a layer the room may not hear.
 */
export const MEETING_HOST_TURN_V5: PromptDefinition<
  MeetingHostVariablesV4,
  MeetingHostResultV3
> = {
  ...MEETING_HOST_TURN_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "Founder P3 2026-10-11: Q in a call answers from a prepared, room-permitted context (company, published mandate, deck claims, disclosed documents, agenda) and the working record of the meeting; may note an action item (NOTE); suggestions are not agreements and a proposed time is not confirmed until the investor explicitly accepts.",
  effectiveFrom: "2026-10-11",
  variables: {
    schema: MeetingHostVariablesV4Schema,
    untrusted: [...MEETING_HOST_UNTRUSTED_V4],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: MEETING_HOST_SCHEMA_NAME,
    schemaVersion: 3,
    schema: MeetingHostResultV3Schema,
  },
  template: [
    [OLD_TOOLS, NEW_TOOLS],
    [OLD_KNOWS, NEW_KNOWS],
    [OLD_BLOCK, NEW_BLOCK],
    [OLD_KINDS, NEW_KINDS],
    [OLD_ASK, NEW_ASK],
  ].reduce(
    (template, [from, to]) => replaced(template, from as string, to as string),
    MEETING_HOST_TURN_V4.template,
  ),
};
