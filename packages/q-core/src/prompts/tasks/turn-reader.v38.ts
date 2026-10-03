import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V29_DESTINATIONS } from "./turn-reader.v29.js";
import { TURN_READER_V37 } from "./turn-reader.v37.js";

/**
 * TURN_READER v38 -- v37 plus the USAGE navigation destination (lead
 * 2026-10-03: Settings → Usage, "what did Q use for me this month?",
 * /settings/usage). Same schema and order as v37; the new words sit in
 * the static prefix.
 */
export const TURN_READER_V38_DESTINATIONS = `${TURN_READER_V29_DESTINATIONS.replace(/\.$/u, "")}, USAGE (what Q used for them this month: its cost by task and by standing instruction, beside their plan's Q limits).`;

if (TURN_READER_V37.template.split(TURN_READER_V29_DESTINATIONS).length !== 2) {
  throw new Error(
    "TURN_READER v38 extends v29's destinations once, which changed",
  );
}

export const TURN_READER_V38: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V37,
  version: 38,
  status: "ACTIVE",
  changeDescription:
    "Lead 2026-10-03: USAGE (Settings → Usage, /settings/usage) is a NAVIGATE destination. Same schema and order as v37.",
  effectiveFrom: "2026-10-03",
  template: TURN_READER_V37.template.replace(
    TURN_READER_V29_DESTINATIONS,
    TURN_READER_V38_DESTINATIONS,
  ),
};
