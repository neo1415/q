import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V18 } from "./turn-reader.v18.js";

/**
 * TURN_READER v19 -- v18 (HARDEN), plus the Rehearsals screen (REHEARSE, founder
 * direction 2026-10-01). Same output schema. Rehearsing with a named
 * person is still the open_page tool (INVESTOR_REHEARSAL /
 * COMPANY_REHEARSAL), not a whole screen.
 */
const V18_LAST_DESTINATION = "NEW_PITCH (add a new pitch video).";

const V19_LAST_DESTINATIONS =
  "NEW_PITCH (add a new pitch video), REHEARSALS (Rehearsals: rehearse a meeting with someone they are connected to, played by Q, and their past rehearsals with reviews).";

if (!TURN_READER_V18.template.includes(V18_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v19 extends v18's NAVIGATE destinations, which v18 lost",
  );
}

export const TURN_READER_V19: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V18,
  version: 19,
  // Deprecated by v20 (DOCS: Documents is a destination).
  status: "DEPRECATED",
  changeDescription:
    "REHEARSE (founder direction 2026-10-01): the Rehearsals screen is a destination.",
  effectiveFrom: "2026-10-01",
  template: TURN_READER_V18.template.replace(
    V18_LAST_DESTINATION,
    V19_LAST_DESTINATIONS,
  ),
};
