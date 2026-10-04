import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV40Result,
  TurnReaderV7Variables,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V40,
  TURN_READER_V40_DESTINATIONS,
} from "./turn-reader.v40.js";

/**
 * TURN_READER v41 -- v40 plus the WORK screen (WORK-58, founder decision
 * 2026-10-04): "show my work", "what's Q doing", "what are you working on
 * for me" open Q's work page. A task given anywhere still goes through the
 * delegation tools as before; only looking at the work is a NAVIGATE. The
 * words sit in the static prefix (v33's cache order); the output schema is
 * v40's, whose destination enum is the contract's.
 */
export const TURN_READER_V41_DESTINATIONS = `${TURN_READER_V40_DESTINATIONS.replace(/\.$/u, "")}, WORK (Work, Q's work page: what Q suggests for them, what waits for their yes, what Q is running for them and what it finished; "show my work", "what's Q doing", "what are you working on for me". Giving Q a task is never WORK: that is the delegation tool).`;

if (TURN_READER_V40.template.split(TURN_READER_V40_DESTINATIONS).length !== 2) {
  throw new Error(
    "TURN_READER v41 extends v40's destinations once, which changed",
  );
}

export const TURN_READER_V41: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV40Result
> = {
  ...TURN_READER_V40,
  version: 41,
  status: "DEPRECATED",
  changeDescription:
    "WORK-58 (founder 2026-10-04): WORK, Q's work page, is a NAVIGATE destination for 'show my work' / 'what's Q doing'; a task is still the delegation tool.",
  effectiveFrom: "2026-10-04",
  template: TURN_READER_V40.template.replace(
    TURN_READER_V40_DESTINATIONS,
    TURN_READER_V41_DESTINATIONS,
  ),
};
