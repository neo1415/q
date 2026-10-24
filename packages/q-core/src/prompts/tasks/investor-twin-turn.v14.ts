import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_TURN_SCHEMA_NAME,
  REHEARSAL_TURN_V10_SCHEMA_VERSION,
  RehearsalTurnV10ResultSchema,
  type RehearsalTurnV8Variables,
  type RehearsalTurnV10Result,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V13 } from "./investor-twin-turn.v13.js";

export const V13_BEATS_END = "Never more entries than line has sentences.";
export const V14_STANCE = `${V13_BEATS_END}
- stance: what this line does in the meeting, by what it means in any language: ASKS when it puts a question to them that waits for their answer; DISAGREES when it disputes, rejects or pushes back on something they said or claimed; DECIDES when it states a decision or a next step (a pass, terms, a follow-up, ending the meeting). null when it does none of these (a greeting, a remark, an acknowledgement). One value; when a line does two, the one it ends on.`;

const V13_RESPOND =
  "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise, screenNote, beats).";
const V14_RESPOND =
  "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise, screenNote, beats, stance).";

function replaced(template: string): string {
  let out = template;
  for (const [from, to] of [
    [V13_BEATS_END, V14_STANCE],
    [V13_RESPOND, V14_RESPOND],
  ] as const) {
    if (out.split(from).length !== 2) {
      throw new Error(`INVESTOR_TWIN_TURN v14: v13 text moved: ${from}`);
    }
    out = out.replace(from, to);
  }
  return out;
}

/**
 * INVESTOR_TWIN_TURN v14 -- owner 2026-10-24 (rehearsal room upgrade): the
 * played person says what their line does -- asks, disagrees or decides --
 * so the room shows a small stance tag while they speak and a quiet "they're
 * waiting for your answer" after a question, from the line itself, never
 * guessed by code from its words. Same variables as v13.
 */
export const INVESTOR_TWIN_TURN_V14: PromptDefinition<
  RehearsalTurnV8Variables,
  RehearsalTurnV10Result
> = {
  ...INVESTOR_TWIN_TURN_V13,
  version: 14,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-24 (rehearsal room upgrade): stance -- ASKS, DISAGREES or DECIDES, what the played line does in the meeting, by meaning in any language; null otherwise.",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_TURN_SCHEMA_NAME,
    schemaVersion: REHEARSAL_TURN_V10_SCHEMA_VERSION,
    schema: RehearsalTurnV10ResultSchema,
  },
  template: replaced(INVESTOR_TWIN_TURN_V13.template),
};
