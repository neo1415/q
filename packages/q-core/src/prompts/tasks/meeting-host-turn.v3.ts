import type { PromptDefinition } from "../definition.js";
import {
  MEETING_HOST_UNTRUSTED_V3,
  MeetingHostVariablesV3Schema,
  type MeetingHostResultV2,
  type MeetingHostVariablesV3,
} from "../schemas/meeting-host.js";
import { MEETING_HOST_TURN_V2 } from "./meeting-host-turn.v2.js";

const OLD_KNOWS =
  "- You know only what is below: the booking, who is here, and what was said aloud in this call.";
const NEW_KNOWS =
  "- You know only what is below: the booking, who is here, what was said aloud in this call, and what is shown in it (shared screens and cameras, as you saw them, and any image attached).";
const OLD_ANSWER =
  "Reply in one or two short spoken sentences (under 40 words), plainly,";
const NEW_ANSWER =
  "Reply as spoken words, at once: the first sentence answers directly in under 15 words; at most one more short sentence (under 35 words in all); no preamble, no restating the question; plainly,";
const OLD_TRANSCRIPT = "THE CALL SO FAR";
const NEW_SEEN = `WHAT IS SHOWN IN THE CALL (screens and cameras everyone in the call can see, as you saw them; empty when nothing)
{{seen}}
- When asked what you see, or about a slide, a demo or something held up, answer from this and any attached image only. Copy numbers exactly as shown. Never describe anyone's face, appearance or identity, and never guess feelings. If nothing is shown, say you can't see anything shared right now.

THE CALL SO FAR`;

function replaced(template: string, from: string, to: string): string {
  // A prompt edit that silently misses its target would publish v2's
  // wording as v3: fail at load instead.
  if (!template.includes(from)) {
    throw new Error(`MEETING_HOST_TURN v3: "${from.slice(0, 40)}" not found`);
  }
  return template.replace(from, to);
}

/**
 * MEETING_HOST_TURN v3 -- founder 2026-10-08: "can Q respond immediately
 * and also see the camera and my screen". v2, plus a short spoken style
 * (a direct first sentence, so the first audio is short) and what is shown
 * in the call (screens and, when on, cameras) as Q saw it.
 */
export const MEETING_HOST_TURN_V3: PromptDefinition<
  MeetingHostVariablesV3,
  MeetingHostResultV2
> = {
  ...MEETING_HOST_TURN_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Founder 2026-10-08: answer at once in a short spoken style (direct first sentence under 15 words); answers may use what is shown in the call (shared screens, cameras when on), never appearance or identity.",
  effectiveFrom: "2026-10-08",
  variables: {
    schema: MeetingHostVariablesV3Schema,
    untrusted: [...MEETING_HOST_UNTRUSTED_V3],
  },
  template: replaced(
    replaced(
      replaced(MEETING_HOST_TURN_V2.template, OLD_KNOWS, NEW_KNOWS),
      OLD_ANSWER,
      NEW_ANSWER,
    ),
    OLD_TRANSCRIPT,
    NEW_SEEN,
  ),
};
