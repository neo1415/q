import type { PromptDefinition } from "../definition.js";
import {
  COUNTERPART_PERSONA_SCHEMA_NAME,
  COUNTERPART_PERSONA_V3_SCHEMA_VERSION,
  CounterpartPersonaLenientSchema,
  type CounterpartPersonaLenient,
  type CounterpartPersonaVariables,
} from "../schemas/investor-persona.js";
import { INVESTOR_PERSONA_V2 } from "./investor-persona.v2.js";

/**
 * INVESTOR_PERSONA v3 -- v2's words, with a lenient output shape that code
 * trims (normaliseCounterpartPersona). Live 2026-10-01: every v2 reading
 * was refused for one list or line a little too long, and no rehearsal
 * could start.
 */
export const INVESTOR_PERSONA_V3: PromptDefinition<
  CounterpartPersonaVariables,
  CounterpartPersonaLenient
> = {
  ...INVESTOR_PERSONA_V2,
  version: 3,
  status: "DEPRECATED",
  changeDescription:
    "REHEARSE audit (live 2026-10-01): lenient output bounds, trimmed by code, so a long list never refuses the whole persona.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: COUNTERPART_PERSONA_SCHEMA_NAME,
    schemaVersion: COUNTERPART_PERSONA_V3_SCHEMA_VERSION,
    schema: CounterpartPersonaLenientSchema,
  },
};
