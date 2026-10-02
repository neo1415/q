import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV28Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V24_DESTINATIONS } from "./turn-reader.v24.js";
import { TURN_READER_V28 } from "./turn-reader.v28.js";

/**
 * TURN_READER v29 -- v28 plus the PASSED navigation destination (QA,
 * 2026-10-02: "show me the companies I passed on" had nowhere to go; the
 * page is /discover/passed). Same output schema as v28.
 */
export const TURN_READER_V29_DESTINATIONS = `${TURN_READER_V24_DESTINATIONS.replace(/\.$/u, "")}, PASSED (their Passed list: companies they passed on in Discover, to look back at or undo a pass; passing is not a judgement on the company).`;

if (!TURN_READER_V28.template.includes(TURN_READER_V24_DESTINATIONS)) {
  throw new Error("TURN_READER v29 extends v24's destinations, which changed");
}

export const TURN_READER_V29: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV28Result
> = {
  ...TURN_READER_V28,
  version: 29,
  status: "ACTIVE",
  changeDescription:
    "QA 2026-10-02: PASSED (the Passed list, /discover/passed) is a NAVIGATE destination. Same schema as v28.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V28.template.replace(
    TURN_READER_V24_DESTINATIONS,
    TURN_READER_V29_DESTINATIONS,
  ),
};
