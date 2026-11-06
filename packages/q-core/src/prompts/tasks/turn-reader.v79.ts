import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V79_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV79ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV79Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V78, V78_WHAT_WAS_ASKED } from "./turn-reader.v78.js";

/**
 * v79 (live 2026-11-06, QIQ-PRO-001). "Who are Silo Credit's CEO and
 * CFO?" was answered with both names from authorised facts that carry no
 * record ids, so the LEDGER held neither person (nor the company). On
 * "When did she join?" the v77 rule left the reader one honest output --
 * the phrase with no refs -- and Q asked who "she" was, where the bare
 * model answered. v79 lets a reference carry the name, as written in
 * RECENT TURNS, of what it means when no LEDGER entry is that one, and
 * says plainly that one clear reading binds and two entries are only for
 * two genuinely plausible readings. Code keeps a name only when it is in
 * the conversation's words. v78 is kept whole; the rule sits right after
 * v78's WHAT WAS ASKED rule, so the cached prefix is unchanged.
 */
export const V79_REFERENCE_NAMES = `REFERENCES BY NAME: who and what a reference means is read from RECENT TURNS and CONVERSATION STATE together, by meaning, the way a person following the conversation would -- the names, roles and companies Q and they have just said count as much as LEDGER. When a reference means a person, company, investor or document named in RECENT TURNS (by them or by Q) that has no LEDGER entry, write it with entityIds empty and named: name is that name exactly as written in RECENT TURNS ("Ngozi Eze", "Silo Credit"), kind is PERSON, COMPANY, INVESTOR_ORGANISATION or DOCUMENT; never a name that is not written there. When the conversation leaves one clear reading (one person it fits, the company everything has been about), write that one entry with confidence HIGH; write two entries only when two readings are both genuinely plausible and the words do not decide; write entityIds empty with no named only when nothing in the conversation fits. A LEDGER entry, when one is that thing, is always pointed at by its E ref.
`;

if (TURN_READER_V78.template.split(V78_WHAT_WAS_ASKED).length !== 2) {
  throw new Error(
    "TURN_READER v79 extends v78's WHAT WAS ASKED rule, which changed",
  );
}

export const TURN_READER_V79: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV79Result
> = {
  ...TURN_READER_V78,
  version: 79,
  status: "ACTIVE",
  changeDescription:
    "Live QIQ-PRO-001: v78 plus references by name -- a reference to a person, company, investor or document named in RECENT TURNS with no LEDGER entry carries that name as written and its kind (named); one clear reading is one HIGH entry, two entries only for two genuinely plausible readings, and no fit only when nothing in the conversation fits. Code keeps a name only when it is in the conversation's words, adds it to that turn's ledger with no record behind it, and lets the answer read an unbound reference from the recent turns instead of asking by default.",
  effectiveFrom: "2026-11-06",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V79_SCHEMA_VERSION,
    schema: TurnReaderV79ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V78.template.replace(
    V78_WHAT_WAS_ASKED,
    `${V78_WHAT_WAS_ASKED}${V79_REFERENCE_NAMES}`,
  ),
};
