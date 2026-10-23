import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_TURN_SCHEMA_NAME,
  REHEARSAL_TURN_V9_SCHEMA_VERSION,
  RehearsalTurnV9ResultSchema,
  type RehearsalTurnV8Variables,
  type RehearsalTurnV9Result,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V12 } from "./investor-twin-turn.v12.js";

const V12_SOUND =
  "Write the words to match: short, sharp sentences when angry; halting ones when upset; light ones when amused.";
const V13_SOUND = `${V12_SOUND}
- beats: when the feeling moves between the sentences of line (a warm greeting, then a skeptical question; a laugh, then a hard number), one entry per sentence of line, in order, each with that sentence's mood and intensity, the first matching mood and intensity above. An empty list when the whole line sounds the same. Never more entries than line has sentences.`;

const V12_RESPOND =
  "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise, screenNote).";
const V13_RESPOND =
  "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise, screenNote, beats).";

function replaced(template: string): string {
  let out = template;
  for (const [from, to] of [
    [V12_SOUND, V13_SOUND],
    [V12_RESPOND, V13_RESPOND],
  ] as const) {
    if (!out.includes(from)) {
      throw new Error(`INVESTOR_TWIN_TURN v13: v12 text moved: ${from}`);
    }
    out = out.replace(from, to);
  }
  return out;
}

/**
 * INVESTOR_TWIN_TURN v13 -- owner 2026-10-23 (rehearsals made real, R5):
 * emotion per sentence. The line's mood and intensity stay (the first
 * sentence, and the line when it does not move); `beats` carries how each
 * sentence sounds when the feeling moves inside the line, so the played
 * person's voice can warm up and then harden within one turn. Same
 * variables as v12.
 */
export const INVESTOR_TWIN_TURN_V13: PromptDefinition<
  RehearsalTurnV8Variables,
  RehearsalTurnV9Result
> = {
  ...INVESTOR_TWIN_TURN_V12,
  version: 13,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-23 (R5): beats -- a mood and intensity per sentence when the feeling moves inside a line; empty when it does not.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_TURN_SCHEMA_NAME,
    schemaVersion: REHEARSAL_TURN_V9_SCHEMA_VERSION,
    schema: RehearsalTurnV9ResultSchema,
  },
  template: replaced(INVESTOR_TWIN_TURN_V12.template),
};
