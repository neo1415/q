import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V40_SCHEMA_VERSION,
  TurnReaderV40ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV40Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V38_DESTINATIONS } from "./turn-reader.v38.js";
import { TURN_READER_V39 } from "./turn-reader.v39.js";

/**
 * TURN_READER v40 -- v39 plus `reference` (follow-55, Zino live
 * 2026-10-04): "open the questions for…" and "open the first documents"
 * were read as NAVIGATE DOCUMENTS and opened the list; "now try again"
 * after a mandate change Q could not prepare was read as NAVIGATE PROFILE.
 * The reader now says which one record they ask to open, and whether they
 * ask for Q's last action again; code resolves both. The words sit in the
 * static prefix, before the per-turn values (v33's cache order).
 */
const ANCHOR =
  "OTHER ACTIONS CAPITAL Q TAKES IN THIS CONVERSATION are listed near the end, under ACTIONS";

export const TURN_READER_V40_REFERENCES = `REFERENCE (what the turn points back to; null when nothing): the last RECENT TURNS line may be Capital Q's own note, starting "[Q context]": SHOWN, numbered, is what Q showed or named most recently, and LAST ACTION is the last action Q took or tried for them, with its inputs and whether it was done. It is Capital Q's record, not something they said.
- open: they ask Q to open ONE specific record, by name or by pointing ("open the deck", "open the questions for Priya", "open my chat with Nixo", "open that one", "the second one", "show me Nixo's pitch"): DOCUMENT (one of their documents), CHAT (the messages with someone), RELATIONSHIP, COMPANY, INVESTOR, MEETING (a meeting with someone: their relationship's page) or PITCH, a company's pitch video. Then tool is null: opening one record is never NAVIGATE, which is only for a screen as a whole ("open my documents", "go to Discover").
- name: the record as they named it, or, when they point ("that one", "it", "the first one"), its name as RECENT TURNS or SHOWN give it. shown: its number in SHOWN when they point by position or at the one just shown.
- retryLast: true when they ask Q to do its LAST ACTION again ("try again", "do it again", "go ahead and do that", "yes, save it" when nothing is waiting for approval and the last action was not done). Then askedAction is that action's name. sameFor: the record it is for this time, when they say "same for X" / "do the same for X".
`;

/** v38's destinations plus Discover's "Your companies" tab (follow-55). */
export const TURN_READER_V40_DESTINATIONS = `${TURN_READER_V38_DESTINATIONS.replace(/\.$/u, "")}, YOUR_COMPANIES (for an investor, Discover's "Your companies" tab: the companies they are connected with, expressed interest in or saved, with their pitches; "open my companies").`;

if (TURN_READER_V39.template.split(TURN_READER_V38_DESTINATIONS).length !== 2) {
  throw new Error(
    "TURN_READER v40 extends v38's destinations once, which changed",
  );
}
if (TURN_READER_V39.template.split(ANCHOR).length !== 2) {
  throw new Error(
    "TURN_READER v40 extends v39's actions pointer, which changed",
  );
}

export const TURN_READER_V40: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV40Result
> = {
  ...TURN_READER_V39,
  version: 40,
  status: "ACTIVE",
  changeDescription:
    "follow-55 (Zino live 2026-10-04): reference -- the one record a turn asks to open (named or pointed at among what Q showed) and a request to repeat Q's last action, so code opens the record and re-runs the action instead of opening a screen; YOUR_COMPANIES (Discover's second tab) is a NAVIGATE destination.",
  effectiveFrom: "2026-10-04",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V40_SCHEMA_VERSION,
    schema: TurnReaderV40ResultSchema,
  },
  template: TURN_READER_V39.template
    .replace(ANCHOR, `${TURN_READER_V40_REFERENCES}${ANCHOR}`)
    .replace(TURN_READER_V38_DESTINATIONS, TURN_READER_V40_DESTINATIONS),
};
