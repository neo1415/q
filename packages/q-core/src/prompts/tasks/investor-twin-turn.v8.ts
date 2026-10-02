import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_TURN_SCHEMA_NAME,
  REHEARSAL_TURN_V7_SCHEMA_VERSION,
  RehearsalTurnV7ResultSchema,
  type RehearsalTurnV6Variables,
  type RehearsalTurnV7Result,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V7 } from "./investor-twin-turn.v7.js";

const READINGS = `- wantsToEnd: true when their latest line asks to end, leave or stop the meeting, or tells you to go -- by meaning, in any wording or language ("let's wrap up", "get lost", "je dois y aller"); false for anything else, including anger that does not ask to end.
- onlyNoise: true when their latest line carries nothing to answer -- background noise, a stray sound, a hesitation with no words, a fragment that is clearly not meant for you; then line may be empty. False whenever they said anything meant for you.
`;

/**
 * INVESTOR_TWIN_TURN v8 -- v7, plus two readings of the person's latest
 * line by meaning: wantsToEnd (they ask to end the meeting) and onlyNoise
 * (nothing was said to answer). Founder live 2026-10-02: "no fixed phrases,
 * let Q judge by meaning" -- code no longer matches their words.
 */
export const INVESTOR_TWIN_TURN_V8: PromptDefinition<
  RehearsalTurnV6Variables,
  RehearsalTurnV7Result
> = {
  ...INVESTOR_TWIN_TURN_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-10-02: wantsToEnd and onlyNoise read by meaning on the turn, in any language, replacing phrase lists in code.",
  effectiveFrom: "2026-10-02",
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_TURN_SCHEMA_NAME,
    schemaVersion: REHEARSAL_TURN_V7_SCHEMA_VERSION,
    schema: RehearsalTurnV7ResultSchema,
  },
  template: INVESTOR_TWIN_TURN_V7.template
    .replace("- askedToSee: true when", `${READINGS}- askedToSee: true when`)
    .replace(
      "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee).",
      "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise).",
    ),
};
