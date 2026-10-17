import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_UNTRUSTED,
  TURN_READER_V54_SCHEMA_VERSION,
  TurnReaderV54ResultSchema,
  TurnReaderV54VariablesSchema,
  type TurnReaderV54Result,
  type TurnReaderV54Variables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V53, V53_Q_PITCH } from "./turn-reader.v53.js";

/**
 * v54 (owner 2026-10-17: "open the data room" / "open the pitch deck" was
 * slow and sometimes did not happen; the owner forbids word matching).
 * The page's own registered tabs and sections reach the reader -- id,
 * kind, a tab's visible name in the person's language, its state -- and
 * `control` names the one they ask to open, select or show now, chosen by
 * meaning. Code works it at once (SELECT_TAB / SCROLL_TO); no extra model
 * round, no search. v53's rules and output are otherwise unchanged.
 */
export const V54_SCREEN_CONTROLS = `PAGE CONTROLS: the tabs and sections of the page on their screen now, one per line as id (kind, its visible name, state), listed by Capital Q from the page itself:
{{screenControls}}
CONTROL: control is the id, copied exactly from PAGE CONTROLS, of the one tab or section they ask to open, select, show, go to or switch to now on this page, chosen by what it means, in any words and any language ("open the data room", "show me their deck", "go to the team", "ouvre la salle de données", "muéstrame el equipo"). A tab named in another language or other words is still that tab when it means the same thing. control is null when PAGE CONTROLS is (none), when nothing listed is what they ask for, when they ask a question about it rather than to see it ("what's in the data room?" is a question), when they ask to make, change or send something, or when they name another company or person than the one on this page (that is a move to that record, read as before). When control is set, the turn is TOOL_REQUEST with tool null.
`;

if (TURN_READER_V53.template.split(V53_Q_PITCH).length !== 2) {
  throw new Error("TURN_READER v54 extends v53's Q PITCH rule, which changed");
}

export const TURN_READER_V54: PromptDefinition<
  TurnReaderV54Variables,
  TurnReaderV54Result
> = {
  ...TURN_READER_V53,
  version: 54,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-17: the page's registered tabs and sections (id, kind, visible name, state) are input, and control names the one the turn asks to open or show, by meaning in any language; code selects it with no further model call. v53's rules unchanged.",
  effectiveFrom: "2026-10-17",
  variables: {
    schema: TurnReaderV54VariablesSchema,
    untrusted: [...TURN_READER_UNTRUSTED, "screenControls"],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V54_SCHEMA_VERSION,
    schema: TurnReaderV54ResultSchema,
  },
  template: TURN_READER_V53.template.replace(
    V53_Q_PITCH,
    `${V53_Q_PITCH}${V54_SCREEN_CONTROLS}`,
  ),
};
