import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V55_SCHEMA_VERSION,
  TURN_READER_V55_UNTRUSTED,
  TurnReaderV55ResultSchema,
  TurnReaderV55VariablesSchema,
  type TurnReaderV55Result,
  type TurnReaderV55Variables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V54, V54_FROM_SHOWN } from "./turn-reader.v54.js";

/**
 * v55 (owner 2026-10-17: "open the data room" / "open the pitch deck" was
 * slow and sometimes did not happen; the owner forbids word matching).
 * v54's SHOWN and fromShown are kept whole. The page's own registered tabs
 * and sections reach the reader -- id, kind, a tab's visible name in the
 * person's language, its state -- and `control` names the one they ask to
 * open, select or show now, chosen by meaning. Code works it at once
 * (SELECT_TAB / SCROLL_TO); no extra model round, no search.
 */
export const V55_SCREEN_CONTROLS = `PAGE CONTROLS: the tabs and sections of the page on their screen now, one per line as id (kind, its visible name, state), listed by Capital Q from the page itself:
{{screenControls}}
CONTROL: control is the id, copied exactly from PAGE CONTROLS, of the one tab or section they ask to open, select, show, go to or switch to now on this page, chosen by what it means, in any words and any language ("open the data room", "show me their deck", "go to the team", "ouvre la salle de données", "muéstrame el equipo"). A tab named in another language or other words is still that tab when it means the same thing. A tab's name said alone, or after "now" or "and", while another tab is open is a request to open it ("now the pitch deck" on a company's page opens its pitch deck tab; it never asks to make a deck). control is null when PAGE CONTROLS is (none), when nothing listed is what they ask for, when they ask a question about it rather than to see it ("what's in the data room?" is a question), when they ask to make, change or send something, or when they name another company or person than the one on this page (that is a move to that record, read as before). When control is set, the turn is TOOL_REQUEST with tool null and fromShown null.
`;

if (TURN_READER_V54.template.split(V54_FROM_SHOWN).length !== 2) {
  throw new Error(
    "TURN_READER v55 extends v54's FROM SHOWN rule, which changed",
  );
}

export const TURN_READER_V55: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV55Result
> = {
  ...TURN_READER_V54,
  version: 55,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-17: v54 (SHOWN, fromShown) plus the page's registered tabs and sections (id, kind, visible name, state) as fenced input, and control naming the one the turn asks to open or show, by meaning in any language; code selects it with no further model call.",
  effectiveFrom: "2026-10-17",
  variables: {
    schema: TurnReaderV55VariablesSchema,
    untrusted: [...TURN_READER_V55_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V55_SCHEMA_VERSION,
    schema: TurnReaderV55ResultSchema,
  },
  template: TURN_READER_V54.template.replace(
    V54_FROM_SHOWN,
    `${V54_FROM_SHOWN}${V55_SCREEN_CONTROLS}`,
  ),
};
