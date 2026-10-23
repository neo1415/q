import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V6_SCHEMA_VERSION,
  TurnSkimV6ResultSchema,
  type TurnSkimV3Variables,
  type TurnSkimV6Result,
} from "../schemas/turn-skim.js";
import { TURN_SKIM_V5 } from "./turn-skim.v5.js";

/**
 * v6 (owner 2026-10-23): Q's first words name whom it is looking into at
 * skim time (~1 s), from the skim's understanding of the turn -- never a
 * name guessed from capital letters or a list of question words. v5 is
 * kept whole; one field is added for every kind.
 */
export const V6_SUBJECT = `subject (every kind): the one company, organisation or person other than the speaker that the turn is about, understood from what they said and the last two turns: name as it should be searched, spelled properly and in full however it was written or heard ("zino aviation" is "Zino Aviation"); kind COMPANY for a company or organisation, PERSON for a person. A turn that points back ("their team", "what about him?", or a yes to Q's offer about them) means the one it points to. null when it is about no one in particular, about several, about themselves or their own company, or about Capital Q, or when you cannot tell who. Never a word of a reply, an agreement, a greeting or a sound.
`;

const BEFORE = "\nEverything between the UNTRUSTED_CONTENT markers";

if (TURN_SKIM_V5.template.split(BEFORE).length !== 2) {
  throw new Error("TURN_SKIM v6 extends v5's closing rules, which changed");
}

export const TURN_SKIM_V6: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV6Result
> = {
  ...TURN_SKIM_V5,
  version: 6,
  status: "ACTIVE",
  changeDescription:
    "Owner 2026-10-23 (first words fast, no keyword triggers): v5 plus subject {name, kind} for every kind -- whom the turn is about, understood from the words and the last two turns, null when no one in particular; Q's holding line names only that.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V6_SCHEMA_VERSION,
    schema: TurnSkimV6ResultSchema,
  },
  template: TURN_SKIM_V5.template.replace(BEFORE, `${V6_SUBJECT}${BEFORE}`),
};
