import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V77_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV77ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV77Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V76, V76_CONVERSATION_STATE } from "./turn-reader.v76.js";

/**
 * v77 (Q intelligence step 3). v76 gave the reader the conversation; v77
 * asks it to say what the turn's pointing words mean, by meaning, as LEDGER
 * refs: "she", "their CFO", "the other deck", "those two", "the second
 * one". Code checks every ref against the ledger it showed this person and
 * binds one reading, asks one short question for two, and says so and asks
 * for none. v76 is kept whole; the rule sits right after v76's CONVERSATION
 * STATE rule, so the cached prefix is unchanged from turn to turn.
 */
export const V77_REFERENCES = `REFERENCES: references lists what the words in WHAT THEY JUST SAID point back at -- a pronoun ("she", "him", "it", "they", "them"), a person by role ("their CFO", "the founder"), a document ("the deck", "the other deck", "that memo"), a place in a list ("the second one", "the last investor"), a set ("those two", "both", "the first three", "all of them"), "this one", "that company", "the one before". One entry per reading: phrase is their words for it (as said, at most a few words); entityIds are the LEDGER E refs it means, in the order they meant them -- a set is one entry with every ref in it; a place in a list counts through LISTS. confidence is HIGH when the conversation leaves one plausible reading, MEDIUM when one reading is clearly likelier, LOW when it is a guess. When two different readings are both plausible and the words do not decide, write two entries with the same phrase, one per reading, and neither HIGH. When the words plainly point back but nothing in CONVERSATION STATE or RECENT TURNS fits, write the phrase with entityIds empty. Only E refs that appear in LEDGER, never a name, a record id or a ref you made up. Names they say in full ("Ngozi Eze", "Silo Credit") are not references. No pointing words: references is empty (leave it out).
`;

if (TURN_READER_V76.template.split(V76_CONVERSATION_STATE).length !== 2) {
  throw new Error(
    "TURN_READER v77 extends v76's CONVERSATION STATE rule, which changed",
  );
}

export const TURN_READER_V77: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV77Result
> = {
  ...TURN_READER_V76,
  version: 77,
  status: "ACTIVE",
  changeDescription:
    "Q intelligence step 3: v76 plus references -- what pronouns, people by role, documents, places in a list and sets point at, as LEDGER refs read by meaning, with HIGH/MEDIUM/LOW confidence, two entries for two plausible readings and none for no fit. Code checks every ref against the ledger shown to the person, binds one reading, asks for two and says so for none.",
  effectiveFrom: "2026-11-05",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V77_SCHEMA_VERSION,
    schema: TurnReaderV77ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V76.template.replace(
    V76_CONVERSATION_STATE,
    `${V76_CONVERSATION_STATE}${V77_REFERENCES}`,
  ),
};
