import type { PromptDefinition } from "../definition.js";
import {
  type MeetingHostResultV2,
  type MeetingHostVariablesV3,
} from "../schemas/meeting-host.js";
import { MEETING_HOST_TURN_V3 } from "./meeting-host-turn.v3.js";

const OLD_ANSWER =
  "Reply as spoken words, at once: the first sentence answers directly in under 15 words; at most one more short sentence (under 35 words in all); no preamble, no restating the question; plainly,";
const NEW_ANSWER =
  "Reply as spoken words, at once and conversationally: the first sentence answers directly in under 20 words; up to two more short sentences when the question deserves them (under 70 words in all); no preamble, no restating the question; plainly,";
const OLD_KINDS = "GUEST, QUIET, LEAVE_REQUEST.";
const NEW_KINDS = "GUEST, QUIET, LEAVE_REQUEST, KEEP_WAITING.";
const WAIT = `- If the other participant has not joined and they ask you to wait, hang on, stay, not leave, or give the others more time (by meaning, in any wording or language), set kind KEEP_WAITING. Code extends the wait within its cap and says the words; your line is ignored. Never agree to a new time or to cancel anything yourself, and never treat silence as agreement to anything.
- If they ask you to leave`;

function replaced(template: string, from: string, to: string): string {
  if (!template.includes(from)) {
    throw new Error(`MEETING_HOST_TURN v4: "${from.slice(0, 40)}" not found`);
  }
  return template.replace(from, to);
}

/**
 * MEETING_HOST_TURN v4 -- live 2026-10-09 (founder): Q left while the founder
 * told it to wait. v3, plus KEEP_WAITING read by meaning (code extends the
 * bounded wait) and a more conversational answer length.
 */
export const MEETING_HOST_TURN_V4: PromptDefinition<
  MeetingHostVariablesV3,
  MeetingHostResultV2
> = {
  ...MEETING_HOST_TURN_V3,
  version: 4,
  status: "DEPRECATED",
  changeDescription:
    "Live 2026-10-09: a request to wait, stay or not leave while the other participant is absent is KEEP_WAITING (code extends the bounded wait); answers are conversational (up to about 70 words) rather than telegraphic.",
  effectiveFrom: "2026-10-09",
  template: replaced(
    replaced(
      replaced(MEETING_HOST_TURN_V3.template, OLD_ANSWER, NEW_ANSWER),
      OLD_KINDS,
      NEW_KINDS,
    ),
    "- If they ask you to leave",
    WAIT,
  ),
};
