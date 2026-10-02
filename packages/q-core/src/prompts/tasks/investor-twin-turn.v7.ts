import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_TURN_SCHEMA_NAME,
  REHEARSAL_TURN_V6_SCHEMA_VERSION,
  RehearsalTurnV6ResultSchema,
  type RehearsalTurnV6Result,
  type RehearsalTurnV6Variables,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V6 } from "./investor-twin-turn.v6.js";

const ONLY_V6 =
  "- Only meeting behaviour and setup, ever: eye contact, reading from notes, distraction, framing, lighting, a busy background.";
const ONLY_V7 = `- askedToSee: true when their latest line asks whether you can see them, or points you to something that would be in view (a whiteboard, a product they hold, their setup) -- by meaning, in any wording or language; otherwise false.
- When they ask you to look and cameraOn is true: answer about what the frame shows -- the object, the whiteboard, their setup -- in character, briefly. If the frame does not clearly show it, say so ("I can't make it out, can you hold it closer?"). Never pretend to see what the frame does not show.
- When they ask you to look and cameraOn is false: say plainly you can't see them -- their camera isn't shared with you -- and that they can switch on "Let Q see you" at the bottom of the call. Never pretend.
- Only meeting behaviour, setup and the objects they show you, ever: eye contact, reading from notes, distraction, framing, lighting, a busy background, a product or a whiteboard.`;

/**
 * INVESTOR_TWIN_TURN v7 -- v6, plus "can you see this?" (2026-10-01): the
 * turn reads by meaning whether the person asks Q to look (askedToSee); code
 * answers it from a fresh camera frame, or, without consent, honestly says
 * Q cannot see them. Objects they show join behaviour and setup; never
 * appearance or identity.
 */
export const INVESTOR_TWIN_TURN_V7: PromptDefinition<
  RehearsalTurnV6Variables,
  RehearsalTurnV6Result
> = {
  ...INVESTOR_TWIN_TURN_V6,
  version: 7,
  status: "DEPRECATED",
  changeDescription:
    "2026-10-01: askedToSee read by meaning; a look on request from a fresh frame, an honest 'I can't see you' without consent, 'I can't make it out' when unclear; objects they show allowed, never appearance or identity.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_TURN_SCHEMA_NAME,
    schemaVersion: REHEARSAL_TURN_V6_SCHEMA_VERSION,
    schema: RehearsalTurnV6ResultSchema,
  },
  template: INVESTOR_TWIN_TURN_V6.template
    .replace(ONLY_V6, ONLY_V7)
    .replace(
      "Never mention a thing the line above does not name.",
      "Never remark on their presence beyond what that line names, except to answer when they ask you to look.",
    )
    .replace(
      "(appraisal, line, move, mood, intensity, reaction, conclusion, presence).",
      "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee).",
    ),
};
