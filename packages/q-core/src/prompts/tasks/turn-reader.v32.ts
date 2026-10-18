import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V31 } from "./turn-reader.v31.js";

/**
 * TURN_READER v32 -- v31 with the action list in a compact grouped form
 * (speed, lead 2026-10-02: the list rides on every turn and the registry
 * grows toward 140 acting tools). Offered actions are "name (a few
 * words)" by area; the rest are names only, one line per area. Same output
 * schema as v31.
 */
export const TURN_READER_V32_ACTIONS = `Grouped by area, each offered one as name (what it does, in a few words); names after "Not available here" are Capital Q actions this conversation does not offer.
{{actionGroups}}`;

if (!TURN_READER_V31.template.includes("{{actions}}")) {
  throw new Error("TURN_READER v32 replaces v31's {{actions}}, which is gone");
}

export const TURN_READER_V32: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V31,
  version: 32,
  status: "DEPRECATED",
  changeDescription:
    "Lead 2026-10-02 (speed): the action list grouped by area -- offered actions as name and a few words, the rest as names only per area. Same schema as v31.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V31.template.replace(
    "{{actions}}",
    TURN_READER_V32_ACTIONS,
  ),
};
