import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_TURN_SCHEMA_NAME,
  REHEARSAL_TURN_V5_SCHEMA_VERSION,
  RehearsalTurnV5ResultSchema,
  RehearsalTurnV6VariablesSchema,
  type RehearsalTurnV5Result,
  type RehearsalTurnV6Variables,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V5 } from "./investor-twin-turn.v5.js";

const SCREEN_V5 =
  "- A frame of their shared screen is attached when screenShared is true: look at it and react or ask about what is on it, as the person would.";

const CAMERA = `${SCREEN_V5}
- A frame of their camera is attached when cameraOn is true (after the screen frame, if any). They chose to let you see them. Read it as a person on a video call would and fill presence: gaze (AT_CAMERA, READING_OFF_SCREEN -- eyes on notes or a second screen, LOOKING_AWAY, or UNCLEAR), distracted, framing, lighting, background (CALM or BUSY), company (someone else is in view) and confident. presence is null when cameraOn is false; use UNCLEAR, false or null whenever the frame does not clearly show it -- unknown stays unknown.
- WHAT YOU MAY SAY ABOUT WHAT YOU SEE (composed by code): {{presence}}
- Only meeting behaviour and setup, ever: eye contact, reading from notes, distraction, framing, lighting, a busy background. Never comment on, describe or infer their appearance, face, body, clothing, age, race, gender, disability, health or religion, or anything about anyone else in view; no guessing who anyone is; no reading emotions from a face. If someone else appears, ignore them or at most say "looks like you have company". Never mention a thing the line above does not name.`;

/**
 * INVESTOR_TWIN_TURN v6 -- v5, plus the person's camera, with consent (founder
 * ask 2026-10-01): a presence reading of meeting behaviour and setup, and
 * at most one in-character remark per issue, chosen by code. Guardrails:
 * never appearance, identity, bystanders or emotion read from a face.
 */
export const INVESTOR_TWIN_TURN_V6: PromptDefinition<
  RehearsalTurnV6Variables,
  RehearsalTurnV5Result
> = {
  ...INVESTOR_TWIN_TURN_V5,
  version: 6,
  status: "DEPRECATED",
  changeDescription:
    "Founder ask 2026-10-01: with consent, a camera frame rides with the turn; a presence reading (gaze, distraction, framing, lighting, background, company, confidence) and one code-chosen remark per issue; guardrails against appearance, identity and emotion from a face.",
  effectiveFrom: "2026-10-01",
  variables: {
    ...INVESTOR_TWIN_TURN_V5.variables,
    schema: RehearsalTurnV6VariablesSchema,
  },
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_TURN_SCHEMA_NAME,
    schemaVersion: REHEARSAL_TURN_V5_SCHEMA_VERSION,
    schema: RehearsalTurnV5ResultSchema,
  },
  template: INVESTOR_TWIN_TURN_V5.template
    .replace(SCREEN_V5, CAMERA)
    .replace(
      "cue {{cue}}, screenShared {{screenShared}}.",
      "cue {{cue}}, screenShared {{screenShared}}, cameraOn {{cameraOn}}.",
    )
    .replace(
      "(appraisal, line, move, mood, intensity, reaction, conclusion).",
      "(appraisal, line, move, mood, intensity, reaction, conclusion, presence).",
    ),
};
