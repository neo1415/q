import type { PromptDefinition } from "../definition.js";
import {
  COUNTERPART_PERSONA_SCHEMA_NAME,
  COUNTERPART_PERSONA_V4_SCHEMA_VERSION,
  CounterpartPersonaV4LenientSchema,
  type CounterpartPersonaV4Lenient,
  type CounterpartPersonaVariables,
} from "../schemas/investor-persona.js";
import { INVESTOR_PERSONA_V3 } from "./investor-persona.v3.js";

const STANCE = `9. forwardness: how hard this person pushes compared with others on their side of the table -- RESERVED, TYPICAL or FORWARD -- only from what the material shows (their own words, calls, public record); TYPICAL when it shows nothing. forwardnessWhy: one line saying what shows it, or "no sign either way".
10. knownTraits: up to eight traits the material actually shows (how they talk, what they react to, what they are known for), each with its source: PROFILE, MESSAGES, CALLS, PUBLIC or PITCH. Only traits with a source; none when the material is thin.

RULES`;

/**
 * INVESTOR_PERSONA v4 -- v3, plus how forward the person is and the known
 * traits behind the reading, each with its source (founder live test
 * 2026-10-01: played as a founder, the persona asked the investor "why are
 * you interested?" as if it held the leverage). Code turns forwardness
 * into who holds the leverage; the lobby shows the traits.
 */
export const INVESTOR_PERSONA_V4: PromptDefinition<
  CounterpartPersonaVariables,
  CounterpartPersonaV4Lenient
> = {
  ...INVESTOR_PERSONA_V3,
  version: 4,
  status: "DEPRECATED",
  changeDescription:
    "Founder live test 2026-10-01: forwardness (with why) and known traits with sources, so the played person knows who holds the leverage and the lobby shows what the reading rests on.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: COUNTERPART_PERSONA_SCHEMA_NAME,
    schemaVersion: COUNTERPART_PERSONA_V4_SCHEMA_VERSION,
    schema: CounterpartPersonaV4LenientSchema,
  },
  template: INVESTOR_PERSONA_V3.template.replace("\n\nRULES", `\n${STANCE}`),
};
