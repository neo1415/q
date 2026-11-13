import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V87_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV87ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV87Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V86, V86_COMPANY_MEDIA } from "./turn-reader.v86.js";

/**
 * v87 (live 13 Nov 2026 on a37e844d5). An investor asked "Can I see
 * Clinicrest's data room?"; the reading was GO with the company referenced,
 * and Q opened the bare profile, because the part of the page they meant
 * was read only by a word list. The owner forbids keyword routing, so the
 * one reading now names that part by meaning, in any language
 * (`navigation.tab`). Which tabs the opened page has, and whether they may
 * open it at all, stay code's.
 *
 * One paragraph is added right after v86's COMPANY MEDIA; the output schema
 * adds `navigation.tab`. Same single reading, no extra call.
 */
export const V87_NAVIGATION_TAB = `NAVIGATION TAB: with navigation.mode GO or CONTEXT for one particular company's or relationship's page, write navigation.tab with the part of that page they mean when they name or plainly mean one, by meaning and in any language: dataroom (its data room, the documents shared for diligence), deck (its pitch deck), elevator (its elevator pitch page), team (its people), diligence (the diligence work on it), messages (their messages or chat with that party), calls (their calls with them), deal (the deal and its terms), overview (its overview). Write null for the record as a whole, and whenever unsure. "Can I see Clinicrest's data room?" is GO with tab dataroom; "what did Ledgerline's team look like?" read as CONTEXT is tab team; "tell me about Ledgerline" is tab null.`;

if (TURN_READER_V86.template.split(V86_COMPANY_MEDIA).length !== 2) {
  throw new Error(
    "TURN_READER v87 follows v86's COMPANY MEDIA paragraph, which changed or repeats",
  );
}

export const TURN_READER_V87: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV87Result
> = {
  ...TURN_READER_V86,
  version: 87,
  status: "ACTIVE",
  changeDescription:
    "Live 13 Nov 2026 ('Can I see Clinicrest's data room?' opened the bare profile): v86 plus one NAVIGATION TAB paragraph -- navigation.tab names the part of a company's or relationship's page they mean (dataroom, deck, elevator, team, diligence, messages, calls, deal, overview), by meaning in any language; null for the record as a whole or when unsure. Code keeps only a tab the opened page has. No extra model call.",
  effectiveFrom: "2026-11-13",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V87_SCHEMA_VERSION,
    schema: TurnReaderV87ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V86.template.replace(
    V86_COMPANY_MEDIA,
    `${V86_COMPANY_MEDIA}\n${V87_NAVIGATION_TAB}`,
  ),
};
