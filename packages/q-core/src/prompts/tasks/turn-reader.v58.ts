import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V58_SCHEMA_VERSION,
  TurnReaderV58ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV58Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V57 } from "./turn-reader.v57.js";

/**
 * v58 (production 2026-10-23): "Yes", said to Q's "Want to dig into its fit
 * details?", was searched and pictured as a company called "Yes" -- the
 * reading said the turn was about someone named, and code guessed who from
 * capital letters. The reader now names the subject itself, by meaning and
 * from the conversation, and code searches and pictures only that. v57 is
 * kept whole; the ABOUT NAMED OTHER rule gains this one.
 */
export const V1_ABOUT_NAMED_OTHER = `ABOUT NAMED OTHER: true when the turn is about a specific company, organisation or person other than the speaker that the words name ("tell me about Acme", "what do you make of Northwind?"); false otherwise, including when they talk about themselves or their own company.
`;

export const V58_NAMED_OTHER = `NAMED OTHER: when aboutNamedOther is true, namedOther is that company, organisation or person: name as it should be searched, spelled properly and in full however it was written or heard ("zino aviation" is "Zino Aviation"), and kind COMPANY for a company or organisation, PERSON for a person. Understand who the turn means from what it says and from the recent turns: a turn that points back ("their team", "what about him?", or a yes to Q's offer about them) means the one it points to. namedOther is null when aboutNamedOther is false, when they mean no one in particular, or when you cannot tell who. It is only ever the name of whom the turn is about: never a word of a reply, an agreement, a greeting or a sound, never their own company, never Capital Q.
`;

if (TURN_READER_V57.template.split(V1_ABOUT_NAMED_OTHER).length !== 2) {
  throw new Error(
    "TURN_READER v58 extends v1's ABOUT NAMED OTHER rule, which changed",
  );
}

export const TURN_READER_V58: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV58Result
> = {
  ...TURN_READER_V57,
  version: 58,
  status: "ACTIVE",
  changeDescription:
    "Production 2026-10-23 ('Yes' searched and pictured as a company): v57 plus namedOther {name, kind} -- the company, organisation or person the turn is about, named by the reader from meaning and the recent turns (a yes to an offer about them, 'their team'), null when no one in particular; code searches and pictures only that, never a name guessed from capital letters or word lists.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V58_SCHEMA_VERSION,
    schema: TurnReaderV58ResultSchema,
  },
  template: TURN_READER_V57.template.replace(
    V1_ABOUT_NAMED_OTHER,
    `${V1_ABOUT_NAMED_OTHER}${V58_NAMED_OTHER}`,
  ),
};
