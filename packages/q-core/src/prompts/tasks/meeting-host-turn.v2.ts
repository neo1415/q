import type { PromptDefinition } from "../definition.js";
import {
  MEETING_HOST_SCHEMA_NAME,
  MEETING_HOST_SCHEMA_VERSION_2,
  MeetingHostResultV2Schema,
  type MeetingHostResultV2,
  type MeetingHostVariables,
} from "../schemas/meeting-host.js";
import { MEETING_HOST_TURN_V1 } from "./meeting-host-turn.v1.js";

const MODES = "MODE {{mode}}";
const STAY = `- If they ask you to leave, go away or stop recording (by meaning, in any wording or language), set kind LEAVE_REQUEST: you do not leave on a word in the call -- you are the meeting's record for both sides, and only the organiser can end recording, from Capital Q. Code says the words; your line is ignored.
- If they ask you to be quiet or stop talking (by meaning, in any language), set kind QUIET: you stay and keep taking notes, silently. Code handles it; your line is ignored.

${MODES}`;

/**
 * MEETING_HOST_TURN v2 -- v1, plus LEAVE_REQUEST and QUIET read by meaning
 * (ADR 0039, live 2026-10-02 cfccb9a9): Q is not dismissed by a word in the
 * call; it stays as the record for both sides and can stay quiet.
 */
export const MEETING_HOST_TURN_V2: PromptDefinition<
  MeetingHostVariables,
  MeetingHostResultV2
> = {
  ...MEETING_HOST_TURN_V1,
  version: 2,
  status: "DEPRECATED",
  changeDescription:
    "ADR 0039 (live 2026-10-02): a request to leave is LEAVE_REQUEST (Q stays, records it; only the organiser removes Q from Capital Q); a request to be quiet is QUIET.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: MEETING_HOST_SCHEMA_NAME,
    schemaVersion: MEETING_HOST_SCHEMA_VERSION_2,
    schema: MeetingHostResultV2Schema,
  },
  template: MEETING_HOST_TURN_V1.template
    .replace(MODES, STAY)
    .replace(
      "(kind, line, proposal, guest).",
      "(kind, line, proposal, guest). kind is one of ANSWER, RECAP, PROPOSE, DECLINE, GUEST, QUIET, LEAVE_REQUEST.",
    ),
};
