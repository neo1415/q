import type { PromptDefinition } from "../definition.js";
import {
  COUNTERPART_PERSONA_SCHEMA_NAME,
  COUNTERPART_PERSONA_V6_SCHEMA_VERSION,
  CounterpartPersonaV6LenientSchema,
  type CounterpartPersonaV5Variables,
  type CounterpartPersonaV6Lenient,
} from "../schemas/investor-persona.js";
import { INVESTOR_PERSONA_V5 } from "./investor-persona.v5.js";

/**
 * INVESTOR_PERSONA v6 -- v5's reading plus how this person conducts
 * themselves when a meeting goes badly (founder feedback 2026-10-03: "if
 * they all behave the same way, doesn't that defeat the purpose?"). Code
 * turns `conduct` into their temperament profile; Q never decides a step.
 */
export const INVESTOR_PERSONA_V6_CONDUCT = `11. conduct: how the {{counterpartRole}} behaves when the meeting goes badly, only from what the material shows (TYPICAL, ANGRY and WARNS_TWICE when it shows nothing):
   - patience: SHORT (loses patience quickly), TYPICAL or LONG (gives people room).
   - warmth: RESERVED (a good answer buys little warmth), TYPICAL or GENEROUS (warms visibly to a good answer).
   - dodgeTolerance: LOW (presses after one evasion), TYPICAL, or HIGH (lets a couple go before pressing).
   - ceiling: the loudest they get. COLD (never raises their voice: goes cold, quiet and formal), IMPATIENT, ANGRY or FURIOUS.
   - leaving: WARNS_TWICE (says so twice before ending a meeting) or ONE_COLD_REMARK (one cool remark, then a polite "I don't think this is for us").`;

const ANCHOR = "\n\nRULES\n";

if (INVESTOR_PERSONA_V5.template.split(ANCHOR).length !== 2) {
  throw new Error(
    "INVESTOR_PERSONA v6 adds conduct before v5's RULES, which changed",
  );
}

export const INVESTOR_PERSONA_V6: PromptDefinition<
  CounterpartPersonaV5Variables,
  CounterpartPersonaV6Lenient
> = {
  ...INVESTOR_PERSONA_V5,
  version: 6,
  status: "ACTIVE",
  changeDescription:
    "Founder feedback 2026-10-03: the reading says how this person conducts themselves under pressure (patience, warmth, dodge tolerance, how loud they get, how they leave), so each played person has their own temperament profile.",
  effectiveFrom: "2026-10-03",
  output: {
    kind: "STRUCTURED",
    schemaName: COUNTERPART_PERSONA_SCHEMA_NAME,
    schemaVersion: COUNTERPART_PERSONA_V6_SCHEMA_VERSION,
    schema: CounterpartPersonaV6LenientSchema,
  },
  template: INVESTOR_PERSONA_V5.template.replace(
    ANCHOR,
    `\n${INVESTOR_PERSONA_V6_CONDUCT}${ANCHOR}`,
  ),
};
